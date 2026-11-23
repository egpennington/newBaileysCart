package com.penningtonlabs.baileyscart.demo.persist

import android.content.Context
import com.penningtonlabs.baileyscart.core.model.offline.FamilyKey
import com.penningtonlabs.baileyscart.core.model.offline.FamilyOutbox
import com.penningtonlabs.baileyscart.core.storage.KeyManager
import com.penningtonlabs.baileyscart.core.storage.LockReason
import com.penningtonlabs.baileyscart.core.storage.OpenResult
import com.penningtonlabs.baileyscart.core.storage.RecoveryAcknowledgement
import com.penningtonlabs.baileyscart.core.storage.RecoveryController
import com.penningtonlabs.baileyscart.core.storage.SetAsideResult
import com.penningtonlabs.baileyscart.core.storage.AccountStore
import com.penningtonlabs.baileyscart.demo.LocalDemoList
import java.io.File

/**
 * LP-2 adapter over the LP-1 encrypted store (:core:storage, unchanged). Debug source set only.
 * One fixed fictional account (E-11a, [DemoIdentity]) and one family scope. Every call must run
 * on the single persistence thread (Room refuses main-thread access).
 *
 * Fail closed: every LP-1 Locked result is surfaced, never repaired. Account files are only ever
 * moved aside by [setAside], after the user's confirmation; nothing here deletes them.
 */
class EncryptedDemoListStore(context: Context) : DemoListStore {
    private val appContext: Context = context.applicationContext
    private val root: File = File(appContext.noBackupFilesDir, DemoIdentity.STORE_DIR)

    // KeyManager loads the Android Keystore, so it is created lazily on the persistence thread.
    private val keys: KeyManager by lazy { KeyManager(root, DemoIdentity.ALIAS_PREFIX) }
    private val recovery: RecoveryController by lazy { RecoveryController(keys) }

    override fun open(): DemoStoreOpen =
        when (val r = AccountStore.open(appContext, keys, DemoIdentity.session(), recovery)) {
            is OpenResult.Opened -> DemoStoreOpen.Opened(Session(r.store))
            is OpenResult.Locked -> DemoStoreOpen.Locked(r.reason.toStoreLock(), canSetAside = r.reason.canSetAside())
        }

    override fun setAside(): SetAsideOutcome {
        // Without the tag key the account's files cannot be identified, so nothing is moved. A
        // Keystore failure here also happens before RecoveryController is called.
        val tag = try {
            keys.accountTag(DemoIdentity.session())
        } catch (_: Exception) {
            null
        } ?: return SetAsideOutcome.NOT_STARTED
        return try {
            when (recovery.setAside(tag, RecoveryAcknowledgement(optedIn = true, confirmed = true))) {
                is SetAsideResult.Done, SetAsideResult.NothingToSetAside -> SetAsideOutcome.DONE
                SetAsideResult.NotAcknowledged -> SetAsideOutcome.NOT_STARTED
            }
        } catch (_: Exception) {
            // I/O or a refused resume: files may already have moved. Decided by the LP-1 marker.
            setAsideOutcomeAfterFailure { recovery.pending(tag) }
        }
    }

    private class Session(private val store: AccountStore) : DemoStoreSession {
        override val key: FamilyKey = FamilyKey(store.account, LocalDemoList.DEMO_FAMILY)

        override fun hasAnyScope(): Boolean = store.stores.scopes().isNotEmpty()

        override fun recover(): FamilyOutbox? = store.stores.recover(key)

        override fun compareAndSet(expected: FamilyOutbox?, updated: FamilyOutbox): Boolean =
            store.stores.outbox.compareAndSet(key, expected, updated)

        override fun purgeDemoFamily() = store.stores.purgeFamily(key)

        override fun close() = store.close()
    }
}

/**
 * Whether a user-confirmed set-aside is offered for an LP-1 lock. Without the tag key the files
 * cannot be identified; a transient Keystore failure (LP-3c) is retried, never set aside.
 */
internal fun LockReason.canSetAside(): Boolean =
    this != LockReason.TAG_KEY_MISSING && !toStoreLock().retryOnly

internal fun LockReason.toStoreLock(): StoreLock = when (this) {
    LockReason.TAG_KEY_MISSING -> StoreLock.TAG_KEY_MISSING
    LockReason.KEY_MISSING -> StoreLock.KEY_MISSING
    LockReason.UNWRAP_FAILED -> StoreLock.UNWRAP_FAILED
    LockReason.KEY_TRANSIENT -> StoreLock.KEY_TRANSIENT
    LockReason.DB_MISSING -> StoreLock.DB_MISSING
    LockReason.DB_UNREADABLE -> StoreLock.DB_UNREADABLE
    LockReason.MIGRATION_FAILED -> StoreLock.MIGRATION_FAILED
    LockReason.DOWNGRADE -> StoreLock.DOWNGRADE
    LockReason.RECOVERY_PENDING -> StoreLock.RECOVERY_PENDING
}
