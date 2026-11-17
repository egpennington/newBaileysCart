package com.penningtonlabs.baileyscart.core.storage

import android.database.sqlite.SQLiteDatabase as FrameworkSQLiteDatabase
import android.content.pm.PackageManager
import android.os.Build
import android.os.Looper
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.penningtonlabs.baileyscart.core.model.offline.Category
import com.penningtonlabs.baileyscart.core.model.offline.FamilyEpoch
import com.penningtonlabs.baileyscart.core.model.offline.FamilyId
import com.penningtonlabs.baileyscart.core.model.offline.FamilyKey
import com.penningtonlabs.baileyscart.core.model.offline.FamilyOutbox
import com.penningtonlabs.baileyscart.core.model.offline.ServerItem
import com.penningtonlabs.baileyscart.core.model.offline.ServerSnapshot
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.concurrent.atomic.AtomicReference

/** WP02-07 (account/family isolation) and WP02-08 (encryption at rest), D2 on a real device/emulator. */
@RunWith(AndroidJUnit4::class)
class EncryptionIsolationTest {
    private val envs = ArrayList<Fx.Env>()
    private fun env(name: String) = Fx.Env(name).also { envs += it }

    @After
    fun cleanup() = envs.forEach { it.cleanup() }

    private fun seed(store: SpikeAccountStore, fam: String = Fx.SENTINEL_FAMILY, item: String = Fx.SENTINEL_ITEM): FamilyKey {
        val key = Fx.family(store, fam)
        var o = FamilyOutbox.empty(key, Fx.E1)
        val o1 = Fx.applied(Fx.add(o, 1, 1, item))
        assertTrue(store.stores.outbox.compareAndSet(key, null, o1))
        o = Fx.applied(Fx.add(o1, 2, 2, Fx.SENTINEL_ITEM_2, Category.PRODUCE))
        assertTrue(store.stores.outbox.compareAndSet(key, o1, o))
        store.stores.list.replace(ServerSnapshot(key, Fx.E1, listOf(ServerItem(Fx.itemId(9), item, Category.DAIRY, 1))))
        return key
    }

    @Test
    fun roundTripReopenAndObservedSecurityLevel() {
        val e = env("roundtrip")
        val s = e.opened("demo-acct-a")
        val key = seed(s)
        val alias = s.keyAlias
        val outbox = s.stores.outbox.read(key)
        s.close()
        val s2 = e.opened("demo-acct-a")
        assertEquals(outbox, s2.stores.outbox.read(key))
        assertEquals(Fx.SENTINEL_ITEM, s2.stores.list.read(key)!!.items.single().name)
        val level = e.keys.securityLevel(alias)
        val strongbox = Fx.context.packageManager.hasSystemFeature(PackageManager.FEATURE_STRONGBOX_KEYSTORE)
        Fx.evidence("KEYSTORE securityLevel=$level strongboxFeature=$strongbox api=${Build.VERSION.SDK_INT} device=${Build.MODEL} abi=${Build.SUPPORTED_ABIS.first()}")
        Fx.evidence("CIPHER " + cipherInventory(s2))
        s2.close()
    }

    private fun cipherInventory(s: SpikeAccountStore): String {
        val db = s.supportDb()
        fun q(sql: String) = db.query(sql).use { if (it.moveToFirst()) it.getString(0) else "<none>" }
        return "cipher_version=${q("PRAGMA cipher_version")} cipher_provider=${q("PRAGMA cipher_provider")} " +
            "cipher_provider_version=${q("PRAGMA cipher_provider_version")} sqlite_version=${q("SELECT sqlite_version()")} " +
            "page_size=${q("PRAGMA page_size")} kdf_iter=${q("PRAGMA kdf_iter")}"
    }

    @Test
    fun noPlaintextAtRestAndScannerPositiveControl() {
        val e = env("plaintext")
        val s = e.opened("demo-acct-a")
        seed(s)
        val dbFile = e.keys.dbFile(s.tag)
        val walBytesBefore = File(dbFile.path + "-wal").length()
        // Scan with the WAL still holding frames (no checkpoint), then again after close (checkpointed).
        val scanned = ArrayList<String>()
        fun scanAll() {
            val candidates = (e.root.walkTopDown().filter { it.isFile } + Fx.context.cacheDir.walkTopDown().filter { it.isFile }).toList()
            for (f in candidates) {
                val bytes = f.readBytes()
                for (needle in listOf(Fx.SENTINEL_ITEM, Fx.SENTINEL_ITEM_2, Fx.SENTINEL_FAMILY, "demo-acct-a")) {
                    assertFalse("plaintext '$needle' found in ${f.name}", Fx.containsAnyEncoding(bytes, needle))
                }
                scanned += "${f.name}:${bytes.size}"
            }
        }
        scanAll()
        assertTrue("scan must cover the database and its live WAL", scanned.any { it.startsWith(dbFile.name + ":") } && scanned.any { it.startsWith(dbFile.name + "-wal:") })
        val cv = s.supportDb().query("PRAGMA cipher_version").use { if (it.moveToFirst()) it.getString(0) else "" }
        assertTrue("database must be opened by SQLCipher", cv.isNotBlank())
        val fingerprintHexPrefix = s.keyFingerprint()
        s.close()
        scanAll()
        // No unexpected temp files (temp_store=MEMORY) and no file names derived from identities.
        e.root.walkTopDown().filter { it.isFile }.forEach {
            assertTrue("unexpected file ${it.name}", it.name.matches(Regex("[0-9a-f]{32}\\.(db|db-wal|db-shm|dek|created)")))
        }
        // Positive control: the same scanner MUST find the sentinel in a plaintext SQLite file.
        val plain = File(e.root, "positive-control-plaintext.sqlite")
        FrameworkSQLiteDatabase.openOrCreateDatabase(plain, null).use {
            it.execSQL("CREATE TABLE t(name TEXT)")
            it.execSQL("INSERT INTO t VALUES (?)", arrayOf(Fx.SENTINEL_ITEM))
        }
        assertTrue("scanner positive control failed", Fx.containsAnyEncoding(plain.readBytes(), Fx.SENTINEL_ITEM))
        plain.delete()
        // Logcat of this process: no sentinels, no key fingerprint.
        val log = Runtime.getRuntime().exec(arrayOf("logcat", "-d", "--pid=${android.os.Process.myPid()}")).inputStream.readBytes()
        for (needle in listOf(Fx.SENTINEL_ITEM, Fx.SENTINEL_ITEM_2, Fx.SENTINEL_FAMILY, fingerprintHexPrefix)) {
            assertFalse("'$needle' found in logcat", Fx.containsAnyEncoding(log, needle))
        }
        Fx.evidence("PLAINTEXT scan clean: files=${scanned.size} walBytesBeforeClose=$walBytesBefore logcatBytes=${log.size}; positive control detected")
    }

    @Test
    fun accountsAndFamiliesAreIsolated() {
        val e = env("isolation")
        val a = e.opened("demo-acct-a")
        val ka = seed(a)
        val ka2 = seed(a, fam = "demo-fam-second", item = "Second family only item")
        val b = e.opened("demo-acct-b")
        val kbSameFamily = Fx.family(b) // same family id as A's first family
        assertNotEquals(a.tag, b.tag)
        assertNotEquals(e.keys.dbFile(a.tag), e.keys.dbFile(b.tag))
        assertNull("B must not see A's outbox for the same family id", b.stores.outbox.read(kbSameFamily))
        assertNull("B must not see A's snapshot", b.stores.list.read(kbSameFamily))
        // Family isolation inside one account. NON-VACUOUS (F-5): both families were seeded with the SAME opIds
        // (1, 2); each must still hold exactly its own two operations with its own payloads.
        val fam1 = a.stores.outbox.read(ka)!!
        val fam2 = a.stores.outbox.read(ka2)!!
        assertEquals("family 1 op count", 2, fam1.operations.size)
        assertEquals("family 2 op count", 2, fam2.operations.size)
        assertEquals(listOf(Fx.uuid(1), Fx.uuid(2)), fam1.operations.map { it.opId.value })
        assertEquals(listOf(Fx.uuid(1), Fx.uuid(2)), fam2.operations.map { it.opId.value })
        assertTrue(fam1.operations.all { it.key == ka } && fam2.operations.all { it.key == ka2 })
        assertEquals(Fx.SENTINEL_ITEM, (fam1.operations[0].command as com.penningtonlabs.baileyscart.core.model.offline.ItemCommand.Add).name.display)
        assertEquals("Second family only item", (fam2.operations[0].command as com.penningtonlabs.baileyscart.core.model.offline.ItemCommand.Add).name.display)
        assertEquals(listOf(Fx.SENTINEL_ITEM), a.stores.list.read(ka)!!.items.map { it.name })
        assertEquals(listOf("Second family only item"), a.stores.list.read(ka2)!!.items.map { it.name })
        // A store refuses another account's scope.
        try {
            a.stores.outbox.read(kbSameFamily)
            fail("scope violation not detected")
        } catch (_: ScopeViolationException) {
        }
        // B's key cannot open A's database (independent probe with B's key).
        val bKey = (e.keys.unwrap(b.tag) as UnwrapResult.Ok).key
        assertEquals(SpikeAccountStore.Companion.Probe.Fail(LockReason.DB_UNREADABLE), SpikeAccountStore.preflight(e.keys.dbFile(a.tag), bKey.sqlcipherKey))
        bKey.wipe()
        a.close()
        b.close()
        Fx.evidence("ISOLATION A/B same familyId: B sees nothing; B key cannot open A db; family predicate isolates families")
    }

    @Test
    fun copiedForeignFilesDoNotUnlockAnotherAccount() {
        val e = env("swap")
        val a = e.opened("demo-acct-a")
        seed(a)
        a.close()
        val tagA = a.tag
        val tagB = e.tag("demo-acct-c")
        // Attacker copies A's database and wrapped key into C's file names (C has no files of its own).
        e.keys.dbFile(tagA).copyTo(e.keys.dbFile(tagB))
        e.keys.dekFile(tagA).copyTo(e.keys.dekFile(tagB))
        val before = Fx.hashes(Fx.files(e.keys.dbFile(tagB)) + e.keys.dekFile(tagB))
        assertEquals(OpenResult.Locked(LockReason.UNWRAP_FAILED), e.open("demo-acct-c"))
        assertEquals("locked files untouched", before, Fx.hashes(Fx.files(e.keys.dbFile(tagB)) + e.keys.dekFile(tagB)))
        Fx.evidence("SWAP copied A db+dek under C: UNWRAP_FAILED (AAD binds tag/file/alias); files preserved")
    }

    @Test
    fun noKeyMaterialInToStringAndNoMainThreadDatabaseWork() {
        val e = env("tostring")
        val s = e.opened("demo-acct-a")
        val key = seed(s)
        val km = (e.keys.unwrap(s.tag) as UnwrapResult.Ok).key
        val hexKey = String(km.sqlcipherKey, Charsets.US_ASCII)
        for (str in listOf(s.toString(), km.toString(), s.tag.toString(), FakeVerifiedSession("demo-acct-a").toString(), key.toString())) {
            assertFalse("key material in toString", hexKey.substring(2, 66) in str)
            assertFalse("raw tag in toString", s.tag.hex in str)
            assertFalse("uid in toString", "demo-acct-a" in str)
        }
        km.wipe()
        val error = AtomicReference<Throwable?>()
        InstrumentationRegistry.getInstrumentation().runOnMainSync {
            check(Looper.myLooper() == Looper.getMainLooper())
            try {
                s.stores.outbox.read(key)
            } catch (t: Throwable) {
                error.set(t)
            }
        }
        assertTrue("main-thread database access must be refused by Room", error.get() is IllegalStateException)
        s.close()
        assertTrue(s.keyWiped())
    }

    @Test
    fun fictionalIdentitiesOnly() {
        try {
            FakeVerifiedSession("real-user-uid-123")
            fail("non-demo identity accepted")
        } catch (_: IllegalArgumentException) {
        }
        assertEquals(FamilyKey::class, FamilyKey(com.penningtonlabs.baileyscart.core.model.offline.AccountKey.of("x")!!, FamilyId.of("y")!!)::class)
        assertEquals(1L, FamilyEpoch.INITIAL.value)
    }
}
