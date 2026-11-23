package com.penningtonlabs.baileyscart.core.storage

import androidx.test.ext.junit.runners.AndroidJUnit4
import com.penningtonlabs.baileyscart.core.model.offline.Category
import com.penningtonlabs.baileyscart.core.model.offline.FamilyKey
import com.penningtonlabs.baileyscart.core.model.offline.FamilyOutbox
import com.penningtonlabs.baileyscart.core.model.offline.OpState
import com.penningtonlabs.baileyscart.core.model.offline.ServerItem
import com.penningtonlabs.baileyscart.core.model.offline.ServerSnapshot
import net.zetetic.database.DefaultDatabaseErrorHandler
import net.zetetic.database.sqlcipher.SQLiteDatabase
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.io.RandomAccessFile

/** WP02-09 (key loss/corruption: LOCKED + preserved), WP02-10 (migration), WP02-12 (sign-out), WP02-14 (lifecycle). */
@RunWith(AndroidJUnit4::class)
class RecoveryLockTest {
    private val envs = ArrayList<Fx.Env>()
    private fun env(name: String) = Fx.Env(name).also { envs += it }

    @After
    fun cleanup() = envs.forEach { it.cleanup() }

    private class Seeded(val e: Fx.Env, val uid: String, val tag: AccountTag, val alias: String, val key: FamilyKey)

    /** An account with an unsent outbox (3 ops) and a snapshot, then closed (quiescent). */
    private fun seeded(name: String): Seeded {
        val e = env(name)
        val uid = "demo-lock-a"
        val s = e.opened(uid)
        val key = Fx.family(s)
        var o: FamilyOutbox? = null
        for (i in 1L..3L) {
            val next = Fx.applied(Fx.add(o ?: FamilyOutbox.empty(key, Fx.E1), i, i, "Locked item $i"))
            assertTrue(s.stores.outbox.compareAndSet(key, o, next))
            o = next
        }
        s.stores.list.replace(ServerSnapshot(key, Fx.E1, listOf(ServerItem(Fx.itemId(50), "Snapshot item", Category.MISC, 1))))
        s.close()
        return Seeded(e, uid, s.tag, s.keyAlias, key)
    }

    private fun protectedFiles(x: Seeded) = Fx.files(x.e.keys.dbFile(x.tag)) + x.e.keys.dekFile(x.tag) + x.e.keys.createdMarker(x.tag)

    /** Apply [damage], then require LOCKED([expected]) with every protected file byte-identical across the error path. */
    private fun assertLockedAndPreserved(name: String, expected: LockReason, checkOther: Boolean = true, damage: (Seeded) -> Unit) {
        val x = seeded(name)
        damage(x)
        val before = Fx.hashes(protectedFiles(x))
        val aliasBefore = x.e.keys.aliasExists(x.alias)
        val r1 = x.e.open(x.uid)
        val r2 = x.e.open(x.uid) // repeated attempts must also be non-destructive
        val after = Fx.hashes(protectedFiles(x))
        assertEquals("$name result", OpenResult.Locked(expected), r1)
        assertEquals("$name repeat", OpenResult.Locked(expected), r2)
        assertEquals("$name: files must be byte-identical across the rejected path", before, after)
        assertEquals("$name: alias presence unchanged", aliasBefore, x.e.keys.aliasExists(x.alias))
        // Another account is unaffected and cannot touch the locked one.
        if (checkOther) {
            val other = x.e.opened("demo-lock-other")
            other.close()
            assertEquals("$name: other account must not modify locked files", before, Fx.hashes(protectedFiles(x)))
        }
        Fx.evidence("LOCK $name -> ${expected.name}; preserved=" + before.entries.joinToString(",") { "${it.key.takeLast(8)}=${it.value.take(12)}" })
    }

    private fun flip(f: File, offset: Long, len: Int = 16) = RandomAccessFile(f, "rw").use { raf ->
        raf.seek(offset)
        val b = ByteArray(len)
        raf.readFully(b)
        for (i in b.indices) b[i] = (b[i].toInt() xor 0x5A).toByte()
        raf.seek(offset)
        raf.write(b)
    }

    @Test fun kekAliasDeleted() = assertLockedAndPreserved("kek-alias-deleted", LockReason.KEY_MISSING) { it.e.keys.deleteAlias(it.alias) }

    @Test fun wrappedKeyFileMissing() = assertLockedAndPreserved("dek-file-missing", LockReason.KEY_MISSING) { it.e.keys.dekFile(it.tag).delete() }

    @Test fun wrappedKeyCiphertextTampered() = assertLockedAndPreserved("dek-gcm-tag-invalid", LockReason.UNWRAP_FAILED) {
        val f = it.e.keys.dekFile(it.tag)
        flip(f, f.length() - 8, 4)
    }

    @Test fun wrappedKeyFromAnotherAccount() = assertLockedAndPreserved("dek-aad-mismatch", LockReason.UNWRAP_FAILED) {
        val other = it.e.opened("demo-lock-donor")
        other.close()
        it.e.keys.dekFile(other.tag).copyTo(it.e.keys.dekFile(it.tag), overwrite = true)
    }

    @Test fun databaseHeaderSaltDamaged() = assertLockedAndPreserved("db-salt-damaged", LockReason.DB_UNREADABLE) { flip(it.e.keys.dbFile(it.tag), 0) }

    @Test fun databaseDataPageDamaged() = assertLockedAndPreserved("db-page-damaged", LockReason.DB_UNREADABLE) {
        val f = it.e.keys.dbFile(it.tag)
        assertTrue("need several pages", f.length() >= 4 * 4096)
        flip(f, 3 * 4096L + 1000)
    }

    @Test fun databaseFileMissingAfterCreation() = assertLockedAndPreserved("db-missing", LockReason.DB_MISSING) { Fx.files(it.e.keys.dbFile(it.tag)).forEach(File::delete) }

    @Test fun downgradeRefused() = assertLockedAndPreserved("downgrade", LockReason.DOWNGRADE) {
        val km = (it.e.keys.unwrap(it.tag) as UnwrapResult.Ok).key
        val db = SQLiteDatabase.openDatabase(it.e.keys.dbFile(it.tag).path, km.sqlcipherKey, null, SQLiteDatabase.OPEN_READWRITE, AccountStore.ThrowingErrorHandler, null)
        db.execSQL("PRAGMA user_version=${AccountDatabase.VERSION + 1}")
        db.close()
        km.wipe()
    }

    @Test fun tagKeyMissingWhileFilesExist() = assertLockedAndPreserved("tag-key-missing", LockReason.TAG_KEY_MISSING, checkOther = false) {
        it.e.keys.deleteAlias(it.e.keys.aliases().single { a -> a.endsWith("tag_v1") })
    }

    /** WAL tampering: report observed behavior honestly (SQLite ignores frames whose checksum fails). */
    @Test
    fun walFrameDamageObservation() {
        val e = env("wal")
        val s = e.opened("demo-wal")
        val key = Fx.family(s)
        val o1 = Fx.applied(Fx.add(FamilyOutbox.empty(key, Fx.E1), 1, 1, "Wal item one"))
        assertTrue(s.stores.outbox.compareAndSet(key, null, o1))
        val wal = File(e.keys.dbFile(s.tag).path + "-wal")
        val walLen = wal.length()
        // Copy the live files while the WAL holds the commit (no checkpoint yet), as a crash would leave them.
        val copyDir = File(e.root, "walcopy").apply { mkdirs() }
        val dbCopy = File(copyDir, e.keys.dbFile(s.tag).name)
        e.keys.dbFile(s.tag).copyTo(dbCopy)
        wal.copyTo(File(dbCopy.path + "-wal"))
        s.close()
        flip(File(dbCopy.path + "-wal"), walLen - 200, 8)
        val km = (e.keys.unwrap(s.tag) as UnwrapResult.Ok).key
        val probe = AccountStore.preflight(dbCopy, km.sqlcipherKey)
        km.wipe()
        Fx.evidence("WAL-DAMAGE walBytes=$walLen tamperedLastFrame probe=$probe (SQLite discards WAL frames failing checksum: last commit may be silently lost; media-corruption limitation)")
    }

    /** Observation of the exact 4.20.0 AAR default handler (hasCodec early return) on a corrupted file. */
    @Test
    fun defaultErrorHandlerDoesNotDeleteWithCodec() {
        val x = seeded("default-handler")
        val f = x.e.keys.dbFile(x.tag)
        flip(f, 0)
        val before = Fx.sha256(f)
        val km = (x.e.keys.unwrap(x.tag) as UnwrapResult.Ok).key
        val outcome = runCatching {
            SQLiteDatabase.openDatabase(f.path, km.sqlcipherKey, null, SQLiteDatabase.OPEN_READWRITE, DefaultDatabaseErrorHandler(), null).use { db ->
                db.rawQuery("SELECT count(*) FROM sqlite_master", null).use { it.moveToFirst() }
            }
        }
        km.wipe()
        assertTrue("hasCodec() must be true in this build", SQLiteDatabase.hasCodec())
        assertTrue("database file must still exist", f.exists())
        assertEquals("database bytes must be unchanged", before, Fx.sha256(f))
        Fx.evidence("DEFAULT-HANDLER hasCodec=true corruptOpen=${outcome.exceptionOrNull()?.javaClass?.simpleName ?: "no-exception"} fileExists=true bytesUnchanged=true")
    }

    @Test
    fun setAsideRequiresExplicitAcknowledgementAndPreservesEverything() {
        val x = seeded("setaside")
        flip(x.e.keys.dbFile(x.tag), 0)
        assertEquals(OpenResult.Locked(LockReason.DB_UNREADABLE), x.e.open(x.uid))
        val before = protectedFiles(x).filter { it.exists() }.associate { it.name to Fx.sha256(it) }
        assertTrue("non-vacuous: db and dek must be present before set-aside", before.keys.any { it.endsWith(".db") } && before.keys.any { it.endsWith(".dek") })
        assertEquals(SetAsideResult.NotAcknowledged, x.e.recovery.setAside(x.tag, RecoveryAcknowledgement(optedIn = false, confirmed = false)))
        assertEquals(SetAsideResult.NotAcknowledged, x.e.recovery.setAside(x.tag, RecoveryAcknowledgement(optedIn = true, confirmed = false)))
        assertEquals(SetAsideResult.NotAcknowledged, x.e.recovery.setAside(x.tag, RecoveryAcknowledgement(optedIn = false, confirmed = true)))
        assertEquals("nothing moved without acknowledgement", before, protectedFiles(x).filter { it.exists() }.associate { it.name to Fx.sha256(it) })
        assertEquals(OpenResult.Locked(LockReason.DB_UNREADABLE), x.e.open(x.uid))
        val done = x.e.recovery.setAside(x.tag, RecoveryAcknowledgement(optedIn = true, confirmed = true)) as SetAsideResult.Done
        val moved = done.quarantineDir.listFiles()!!.filter { it.name in before.keys }.associate { it.name to Fx.sha256(it) }
        assertEquals("set-aside moves every file byte-identical", before, moved)
        assertTrue("old KEK alias retained", x.e.keys.aliasExists(x.alias))
        // Only now does the account open fresh (explicitly acknowledged); the quarantine is untouched.
        val fresh = x.e.opened(x.uid)
        assertNull(fresh.stores.outbox.read(x.key))
        fresh.close()
        assertEquals(before, done.quarantineDir.listFiles()!!.filter { it.name in before.keys }.associate { it.name to Fx.sha256(it) })
        Fx.evidence("SETASIDE refused x3 without full acknowledgement; acknowledged move byte-identical; alias retained; quarantine not deleted")
    }

    @Test
    fun signOutClosesWipesKeepsEncryptedOutboxAndHidesItFromOtherAccount() {
        val e = env("signout")
        val a = e.opened("demo-signout-a")
        val key = Fx.family(a)
        val o = Fx.applied(Fx.add(FamilyOutbox.empty(key, Fx.E1), 1, 1, Fx.SENTINEL_ITEM))
        assertTrue(a.stores.outbox.compareAndSet(key, null, o))
        a.stores.list.replace(ServerSnapshot(key, Fx.E1, listOf(ServerItem(Fx.itemId(7), "Snap", Category.DAIRY, 1))))
        // Experimental sign-out: stop dispatch (no coordinator running), drop snapshots, close, wipe key.
        a.stores.dropAllSnapshots()
        a.close()
        assertTrue(a.isClosed())
        assertTrue("in-memory key wiped", a.keyWiped())
        val b = e.opened("demo-signout-b")
        assertNull("B cannot see A's dormant queue", b.stores.outbox.read(Fx.family(b)))
        b.close()
        val a2 = e.opened("demo-signout-a")
        assertEquals("dormant encrypted outbox retained", o, a2.stores.outbox.read(key))
        assertNull("snapshot dropped at sign-out (experimental policy)", a2.stores.list.read(key))
        a2.close()
    }

    @Test
    fun revocationPurgeRemovesOnlyThatFamily() {
        val e = env("purge")
        val s = e.opened("demo-purge")
        val k1 = Fx.family(s, "demo-fam-one")
        val k2 = Fx.family(s, "demo-fam-two")
        assertTrue(s.stores.outbox.compareAndSet(k1, null, Fx.applied(Fx.add(FamilyOutbox.empty(k1, Fx.E1), 1, 1, "One"))))
        val o2 = Fx.applied(Fx.add(FamilyOutbox.empty(k2, Fx.E1), 2, 2, "Two"))
        assertTrue(s.stores.outbox.compareAndSet(k2, null, o2))
        s.stores.purgeFamily(k1)
        assertNull(s.stores.outbox.read(k1))
        assertEquals(o2, s.stores.outbox.read(k2))
        assertEquals(listOf(k2), s.stores.scopes())
        s.close()
    }

    /** WP02-10: v1 database with an unsent outbox, blocked and in-flight state, migrated to v2 in place. */
    @Test
    fun migrationPreservesOutboxScopeEpochAndSnapshot() {
        val e = env("migration")
        val uid = "demo-migrate"
        val tag = e.tag(uid)
        val km = e.keys.create(tag)
        val key = FamilyKey(com.penningtonlabs.baileyscart.core.model.offline.AccountKey.of(tag.hex)!!, com.penningtonlabs.baileyscart.core.model.offline.FamilyId.of(Fx.SENTINEL_FAMILY)!!)
        // Build the reference outbox with the S2a domain: op1 rejected -> op2 blocked, op3 in flight, op4 pending.
        var o = FamilyOutbox.empty(key, Fx.E1)
        o = Fx.applied(Fx.add(o, 1, 1, "Mig one"))
        o = Fx.applied(Fx.edit(o, 2, 1, "Mig one edited"))
        o = Fx.applied(Fx.add(o, 3, 2, "Mig two", Category.FROZEN))
        o = Fx.applied(Fx.add(o, 4, 3, "Mig three", Category.MEAT))
        o = (o.dispatchNext() as com.penningtonlabs.baileyscart.core.model.offline.Dispatch.Send).outbox
        o = Fx.applied(o.recordRejected(key, Fx.opId(1), Fx.REJECT))
        o = (o.dispatchNext() as com.penningtonlabs.baileyscart.core.model.offline.Dispatch.Send).outbox
        assertEquals(OpState.IN_FLIGHT, o.operation(Fx.opId(3))!!.state)
        MigrationFixture.writeV1(e.keys.dbFile(tag), km.sqlcipherKey, o)
        km.wipe()
        val beforeV1 = Fx.sha256(e.keys.dbFile(tag))
        val s = e.opened(uid)
        val migrated = s.stores.outbox.read(key)!!
        val expected = (FamilyOutbox.restore(key, o.currentEpoch, o.access, o.operations) as com.penningtonlabs.baileyscart.core.model.offline.FamilyOutboxRestore.Restored).outbox
        assertEquals("migration preserved every operation field (recovery view)", expected, migrated)
        assertEquals(OpState.BLOCKED_DEPENDENCY, migrated.operation(Fx.opId(2))!!.state)
        assertEquals(OpState.RETRY_WAIT, migrated.operation(Fx.opId(3))!!.state)
        assertEquals("Mig snapshot", s.stores.list.read(key)!!.items.single().name)
        val version = s.supportDb().query("PRAGMA user_version").use { it.moveToFirst(); it.getInt(0) }
        assertEquals(AccountDatabase.VERSION, version)
        s.close()
        Fx.evidence("MIGRATION v1->v3 preserved ${migrated.operations.size} ops (states ${migrated.operations.map { it.state }}), epoch, snapshot; v1sha=${beforeV1.take(12)}")
    }

    @Test
    fun failingMigrationLocksAndPreserves() {
        val e = env("migfail")
        val uid = "demo-migfail"
        val tag = e.tag(uid)
        val km = e.keys.create(tag)
        MigrationFixture.writeV1(e.keys.dbFile(tag), km.sqlcipherKey, null, omitSnapshotHeader = true)
        km.wipe()
        val before = Fx.hashes(listOf(e.keys.dbFile(tag), e.keys.dekFile(tag)))
        val walShmBefore = Fx.hashes(Fx.files(e.keys.dbFile(tag)).drop(1))
        assertEquals(OpenResult.Locked(LockReason.MIGRATION_FAILED), e.open(uid))
        assertEquals("rolled-back migration leaves the database and key byte-identical", before, Fx.hashes(listOf(e.keys.dbFile(tag), e.keys.dekFile(tag))))
        assertFalse(e.keys.createdMarker(tag).exists())
        assertEquals(OpenResult.Locked(LockReason.MIGRATION_FAILED), e.open(uid))
        Fx.evidence("MIGRATION-FAIL locked; db+dek identical; wal/shm before=$walShmBefore after=${Fx.hashes(Fx.files(e.keys.dbFile(tag)).drop(1))}")
    }
}
