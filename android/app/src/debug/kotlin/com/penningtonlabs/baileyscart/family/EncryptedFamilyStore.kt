package com.penningtonlabs.baileyscart.family

import android.content.Context
import com.penningtonlabs.baileyscart.core.model.offline.FamilyId
import com.penningtonlabs.baileyscart.core.model.offline.FamilyKey
import com.penningtonlabs.baileyscart.core.model.offline.FamilyOutbox
import com.penningtonlabs.baileyscart.core.model.offline.ServerSnapshot
import com.penningtonlabs.baileyscart.core.storage.AccountStore
import com.penningtonlabs.baileyscart.core.storage.FakeVerifiedSession
import com.penningtonlabs.baileyscart.core.storage.KeyManager
import com.penningtonlabs.baileyscart.core.storage.OpenResult
import com.penningtonlabs.baileyscart.core.storage.RecoveryController
import java.io.File
import java.security.MessageDigest

/**
 * BC-FAMILY-SYNC-01 Step 2 (debug source set only): the LP-1 SQLCipher store, ONE store per
 * (uid, familyId) as Sync Contract Rev 2 section 2 requires, so revoking one family never touches
 * another family's or another user's data.
 *
 * Storage identity: `:core:storage` accepts only fictional `demo-` identities (FakeVerifiedSession),
 * so the store identity is `demo-fs-` plus a SHA-256 prefix of (emulator uid, familyId). The raw
 * uid never reaches a file name or alias: the LP-1 KeyManager turns the identity into an HMAC tag
 * with a Keystore key. This is an emulator-only interpretation recorded for GAI review; real
 * accounts remain governed by D-11.
 *
 * Every call runs on the engine's serial thread (Room refuses main-thread access).
 */
class EncryptedFamilyStore(context: Context) : FamilyStoreFactory {
    private val appContext: Context = context.applicationContext
    private val root: File = File(appContext.noBackupFilesDir, STORE_DIR)

    private val keys: KeyManager by lazy { KeyManager(root, ALIAS_PREFIX) }
    private val recovery: RecoveryController by lazy { RecoveryController(keys) }

    override fun open(uid: String, familyId: String): StoreOpen {
        val family = FamilyId.of(familyId) ?: return StoreOpen.Locked("BAD_FAMILY_ID")
        return when (val r = AccountStore.open(appContext, keys, FakeVerifiedSession(storageIdentity(uid, familyId)), recovery)) {
            is OpenResult.Opened -> StoreOpen.Opened(Session(r.store, FamilyKey(r.store.account, family)))
            is OpenResult.Locked -> StoreOpen.Locked(r.reason.name)
        }
    }

    override fun purge(uid: String, familyId: String): PurgeOutcome {
        val tag = keys.accountTag(FakeVerifiedSession(storageIdentity(uid, familyId))) ?: return PurgeOutcome.FAILED
        // 1. The KEK first: once it is gone the wrapped DEK, and so the database, is unreadable even
        //    if deleting the files below is interrupted.
        val kekPrefix = "${ALIAS_PREFIX}kek_v1_${tag.hex}_"
        val keyGone = try {
            keys.aliases().filter { it.startsWith(kekPrefix) }.forEach(keys::deleteAlias)
            keys.aliases().none { it.startsWith(kekPrefix) }
        } catch (_: Exception) {
            false
        }
        if (!keyGone) return PurgeOutcome.FAILED
        // 2. Then this store's files only.
        val db = keys.dbFile(tag)
        val files = listOf(
            db,
            File(db.path + "-wal"),
            File(db.path + "-shm"),
            File(db.path + "-journal"),
            keys.dekFile(tag),
            File(keys.dekFile(tag).path + ".tmp"),
            keys.createdMarker(tag),
        )
        files.forEach { runCatching { it.delete() } }
        return if (files.none { it.exists() }) PurgeOutcome.DONE else PurgeOutcome.KEY_DELETED_FILES_REMAIN
    }

    private class Session(private val store: AccountStore, override val key: FamilyKey) : FamilyStoreSession {
        override fun recover(): FamilyOutbox? = store.stores.recover(key)

        override fun compareAndSet(expected: FamilyOutbox?, updated: FamilyOutbox): Boolean =
            store.stores.outbox.compareAndSet(key, expected, updated)

        override fun readSnapshot(): ServerSnapshot? = store.stores.readSnapshot(key)

        override fun replaceSnapshot(snapshot: ServerSnapshot) = store.stores.list.replace(snapshot)

        override fun close() = store.close()
    }

    companion object {
        /** Under Context.noBackupFilesDir. Distinct from the LOCAL DEMO store. */
        const val STORE_DIR: String = "bc-family-sync-store"

        /** Keystore alias prefix (letters, digits and `_` only). */
        const val ALIAS_PREFIX: String = "bcfs_"

        /** `demo-fs-` + 40 hex characters of SHA-256("bc-fs-v1|uid|familyId"). */
        fun storageIdentity(uid: String, familyId: String): String {
            val digest = MessageDigest.getInstance("SHA-256").digest("bc-fs-v1|$uid|$familyId".toByteArray(Charsets.UTF_8))
            return "demo-fs-" + digest.take(20).joinToString("") { "%02x".format(it) }
        }
    }
}
