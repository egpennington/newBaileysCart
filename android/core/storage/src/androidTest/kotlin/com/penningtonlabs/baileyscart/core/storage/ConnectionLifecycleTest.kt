package com.penningtonlabs.baileyscart.core.storage

import androidx.test.ext.junit.runners.AndroidJUnit4
import com.penningtonlabs.baileyscart.core.model.offline.FamilyOutbox
import net.zetetic.database.sqlcipher.SQLiteConnection
import net.zetetic.database.sqlcipher.SQLiteDatabaseConfiguration
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.lang.ref.WeakReference

/**
 * BC-STORAGE-REL-SR1: connection lifetime.
 *
 * Deterministic cleanup checks read two private fields of the pinned SQLCipher 4.20.0 connection:
 *  - `mConnectionPtr`: set to 0 when the connection is disposed (native handle closed);
 *  - `mConfiguration.password`: the same array object as `KeyMaterial.sqlcipherKey` (SupportOpenHelperFactory,
 *    SupportHelper, SQLiteOpenHelper, SQLiteDatabase and SQLiteDatabaseConfiguration pass the reference and
 *    never copy it), so it is all zero exactly when the store's key has been wiped.
 * The garbage-collection test is supporting evidence only: a collector run cannot be forced.
 */
@RunWith(AndroidJUnit4::class)
class ConnectionLifecycleTest {
    private val envs = ArrayList<Fx.Env>()
    private fun env(name: String) = Fx.Env(name).also { envs += it }

    @After
    fun cleanup() = envs.forEach { it.cleanup() }

    private class Recorder : ConnectionObserver {
        val seen = ArrayList<SQLiteConnection>()
        override fun onConfigured(connection: SQLiteConnection, synchronousAfterHook: Long, tempStore: String, secureDelete: String) {
            seen += connection
        }
    }

    private fun nativeHandle(c: SQLiteConnection): Long =
        SQLiteConnection::class.java.getDeclaredField("mConnectionPtr").apply { isAccessible = true }.getLong(c)

    private fun keyBytes(c: SQLiteConnection): ByteArray {
        val cfg = SQLiteConnection::class.java.getDeclaredField("mConfiguration").apply { isAccessible = true }.get(c)
        return (cfg as SQLiteDatabaseConfiguration).password
    }

    private fun assertReleased(label: String, c: SQLiteConnection) {
        assertEquals("$label: native connection handle closed", 0L, nativeHandle(c))
        val key = keyBytes(c)
        assertTrue("$label: key bytes present", key.isNotEmpty())
        assertTrue("$label: key bytes wiped", key.all { it == 0.toByte() })
    }

    /** Blocks the first-creation `.created` marker write: its temporary file path is made a directory. */
    private fun blockCreatedMarker(e: Fx.Env, uid: String): File =
        File(e.keys.createdMarker(e.tag(uid)).path + ".tmp").apply { assertTrue(mkdirs()) }

    private fun openFails(e: Fx.Env, uid: String, observer: ConnectionObserver): Throwable {
        try {
            val r = e.open(uid, observer)
            fail("expected the open to fail, was $r")
        } catch (t: Throwable) {
            if (t is AssertionError) throw t
            return t
        }
        error("unreachable")
    }

    @Test
    fun aFailedCreatedMarkerWriteClosesTheConnectionAndWipesTheKey() {
        val e = env("sr1-fail")
        val uid = "demo-sr1-fail"
        blockCreatedMarker(e, uid)
        val rec = Recorder()
        val thrown = openFails(e, uid, rec)
        Fx.evidence("SR1 failed open threw ${thrown.javaClass.simpleName}")
        assertEquals("one connection was opened before the failure", 1, rec.seen.size)
        assertReleased("failed open", rec.seen.single())
        val tag = e.tag(uid)
        assertTrue("the database was created", e.keys.dbFile(tag).exists())
        assertFalse("no .created marker", e.keys.createdMarker(tag).exists())
    }

    @Test
    fun afterTheFailureIsRemovedTheStoreOpensWritesAndReopensWithTheSameData() {
        val e = env("sr1-recover")
        val uid = "demo-sr1-recover"
        val blocker = blockCreatedMarker(e, uid)
        openFails(e, uid, Recorder())
        assertTrue(blocker.delete())

        val rec = Recorder()
        val s = e.opened(uid, rec)
        assertEquals(1, rec.seen.size)
        assertTrue("the .created marker is written on recovery", e.keys.createdMarker(e.tag(uid)).exists())
        val key = Fx.family(s)
        val written = Fx.applied(Fx.add(FamilyOutbox.empty(key, Fx.E1), 1, 1, "Recovered item"))
        assertTrue(s.stores.outbox.compareAndSet(key, null, written))
        s.close()
        assertReleased("closed after recovery", rec.seen.single())

        val again = e.opened(uid)
        assertEquals("data written after recovery survives a reopen", written, again.stores.outbox.read(key))
        again.close()
    }

    @Test
    fun closeReleasesTheObservedConnectionAndWipesTheKey() {
        val e = env("sr1-close")
        val rec = Recorder()
        val s = e.opened("demo-sr1-close", rec)
        val c = rec.seen.single()
        assertTrue("open connection has a native handle", nativeHandle(c) != 0L)
        assertFalse("open store key not wiped", keyBytes(c).all { it == 0.toByte() })
        s.close()
        assertReleased("after close", c)
    }

    /** No process-wide state: an observer sees only the open it was passed to, and an open without one notifies no one. */
    @Test
    fun eachObserverSeesOnlyTheOpenItWasPassedTo() {
        val e = env("sr1-iso")
        val a = Recorder()
        e.opened("demo-sr1-a", a).close()
        val b = Recorder()
        e.opened("demo-sr1-b", b).close()
        e.opened("demo-sr1-a").close()
        e.opened("demo-sr1-b").close()
        assertEquals("observer A: its own open only", 1, a.seen.size)
        assertEquals("observer B: its own open only", 1, b.seen.size)
        assertTrue("different connections", a.seen.single() !== b.seen.single())
    }

    private fun openWriteCloseKeepingOnlyAWeakReference(e: Fx.Env, uid: String): WeakReference<SQLiteConnection> {
        var ref: WeakReference<SQLiteConnection>? = null
        val s = e.opened(uid) { c, _, _, _ -> ref = WeakReference(c) }
        val key = Fx.family(s)
        assertTrue(s.stores.outbox.compareAndSet(key, null, Fx.applied(Fx.add(FamilyOutbox.empty(key, Fx.E1), 1, 1, "GC item"))))
        s.close()
        return ref!!
    }

    /** Supporting evidence only (collection cannot be forced): nothing keeps a closed store's connection reachable. */
    @Test
    fun aClosedStoresConnectionBecomesCollectable() {
        val e = env("sr1-gc")
        val ref = openWriteCloseKeepingOnlyAWeakReference(e, "demo-sr1-gc")
        var rounds = 0
        while (ref.get() != null && rounds < 50) {
            rounds++
            @Suppress("UNUSED_VARIABLE") val pressure = ByteArray(4 * 1024 * 1024)
            Runtime.getRuntime().gc()
            System.runFinalization()
            Thread.sleep(100)
        }
        Fx.evidence("SR1 GC: connection collected=${ref.get() == null} after $rounds round(s)")
        assertNull("closed connection still reachable after $rounds GC rounds", ref.get())
    }
}
