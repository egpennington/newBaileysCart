package com.penningtonlabs.baileyscart.core.storage

import androidx.test.ext.junit.runners.AndroidJUnit4
import com.penningtonlabs.baileyscart.core.model.offline.FamilyKey
import com.penningtonlabs.baileyscart.core.model.offline.FamilyOutbox
import com.penningtonlabs.baileyscart.core.model.offline.OpId
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.io.RandomAccessFile

/**
 * WP02-13 (BC-S2-LOCAL-PERSIST LP-1): bounded WAL last-frame media-damage behavior.
 *
 * SQLite stops WAL recovery at the first frame whose checksum fails, so damage to the final frame of the
 * WAL silently discards the LAST committed transaction (a disclosed limitation for fictional demo data; it
 * is media damage, not crash or power loss, which WAL + synchronous=FULL covers). This test bounds that
 * loss: it must be exactly the final transaction, earlier transactions and the sibling family must be
 * intact, the store must open through the normal path (no LOCKED state, no destructive fallback, no
 * set-aside), and the reopened store must stay writable. An undamaged copy of the same crash image is
 * reopened first as the control, proving the copy technique itself loses nothing.
 */
@RunWith(AndroidJUnit4::class)
class WalLastFrameBoundTest {
    private val envs = ArrayList<Fx.Env>()

    @After
    fun cleanup() = envs.forEach { it.cleanup() }

    private fun ops(store: SpikeAccountStore, key: FamilyKey): List<OpId> =
        store.stores.outbox.read(key)?.operations?.map { it.opId } ?: emptyList()

    private fun be32(b: ByteArray, at: Int): Long =
        ((b[at].toLong() and 0xff) shl 24) or ((b[at + 1].toLong() and 0xff) shl 16) or
            ((b[at + 2].toLong() and 0xff) shl 8) or (b[at + 3].toLong() and 0xff)

    private fun header(wal: File): ByteArray = RandomAccessFile(wal, "r").use { r -> ByteArray(32).also { r.readFully(it) } }

    /** Replace the account's live files with a saved crash image (db + wal; -shm is rebuilt by SQLite). */
    private fun install(image: File, db: File) {
        for (f in Fx.files(db)) if (f.exists()) assertTrue("could not remove ${f.name}", f.delete())
        File(image, "db").copyTo(db)
        File(image, "wal").copyTo(File(db.path + "-wal"))
    }

    @Test
    fun lastFrameDamageLosesExactlyTheFinalTransactionAndNothingElse() {
        val e = Fx.Env("walbound").also { envs += it }
        val uid = "demo-walbound"
        val s = e.opened(uid)
        val a = Fx.family(s)
        val b = Fx.family(s, "demo-fam-walbound-sibling")
        val db = e.keys.dbFile(s.tag)
        val wal = File(db.path + "-wal")

        // T1 (family A), T2 (sibling family B), T3 (family A): each compareAndSet is exactly one transaction.
        val a1 = Fx.applied(Fx.add(FamilyOutbox.empty(a, Fx.E1), 1, 1, "Wal bound one"))
        assertTrue(s.stores.outbox.compareAndSet(a, null, a1))
        val b1 = Fx.applied(Fx.add(FamilyOutbox.empty(b, Fx.E1), 1, 9, "Wal bound sibling"))
        assertTrue(s.stores.outbox.compareAndSet(b, null, b1))
        val a2 = Fx.applied(Fx.add(a1, 2, 2, "Wal bound two"))
        assertTrue(s.stores.outbox.compareAndSet(a, a1, a2))
        val dbHashAfterT3 = Fx.sha256(db)
        val walLenAfterT3 = wal.length()
        val headerAfterT3 = header(wal)

        // T4 (family A): the final transaction, whose last (commit) frame will be damaged.
        val a3 = Fx.applied(Fx.add(a2, 3, 3, "Wal bound three"))
        assertTrue(s.stores.outbox.compareAndSet(a, a2, a3))
        val walLen = wal.length()
        val hdr = header(wal)
        val pageSize = be32(hdr, 8)
        val frameSize = 24 + pageSize

        // Preconditions: T4 was appended to the same WAL generation and nothing was checkpointed in between,
        // so T4 occupies exactly the bytes [walLenAfterT3, walLen) and its commit frame is the last frame.
        assertEquals("main database changed between T3 and T4 (checkpoint)", dbHashAfterT3, Fx.sha256(db))
        assertTrue("WAL header (salts) changed between T3 and T4", headerAfterT3.contentEquals(hdr))
        assertTrue("T4 appended no WAL frames", walLen > walLenAfterT3)
        assertEquals("WAL tail is not whole frames", 0L, (walLen - walLenAfterT3) % frameSize)
        assertEquals("WAL is not header + whole frames", 0L, (walLen - 32) % frameSize)
        val lastFrame = walLen - frameSize
        val commitSize = RandomAccessFile(wal, "r").use { r -> r.seek(lastFrame + 4); r.readInt().toLong() }
        assertTrue("last frame is not a commit frame", commitSize > 0)

        // Crash image: copy db + wal while the store is open (as SIGKILL would leave them), then close.
        val image = File(e.root, "crash-image").apply { mkdirs() }
        db.copyTo(File(image, "db"))
        wal.copyTo(File(image, "wal"))
        s.close()
        val dekHash = Fx.sha256(e.keys.dekFile(s.tag))

        // Control: the undamaged image reopens with all four transactions.
        install(image, db)
        val c = e.opened(uid)
        assertEquals("control lost data", listOf(Fx.opId(1), Fx.opId(2), Fx.opId(3)), ops(c, a))
        assertEquals("control sibling", listOf(Fx.opId(1)), ops(c, b))
        c.close()

        // Damage 8 bytes in the middle of the page image of the LAST frame only (inside T4's byte range).
        install(image, db)
        val damageAt = lastFrame + 24 + pageSize / 2
        assertTrue(damageAt >= walLenAfterT3 && damageAt + 8 <= walLen)
        RandomAccessFile(File(db.path + "-wal"), "rw").use { r ->
            r.seek(damageAt)
            val buf = ByteArray(8)
            r.readFully(buf)
            for (i in buf.indices) buf[i] = (buf[i].toInt() xor 0x5A).toByte()
            r.seek(damageAt)
            r.write(buf)
        }

        // Bound: opens normally (silent loss is the disclosed limitation), loses exactly T4, nothing else.
        val r = e.open(uid)
        assertTrue("damaged last frame must not lock the store (expected silent bounded loss): $r", r is OpenResult.Opened)
        val d = (r as OpenResult.Opened).store
        assertEquals("exactly the final transaction must be lost", listOf(Fx.opId(1), Fx.opId(2)), ops(d, a))
        assertEquals("sibling family must be intact", listOf(Fx.opId(1)), ops(d, b))
        assertFalse("no recovery set-aside may be triggered", e.recovery.pending(d.tag))
        assertFalse("no quarantine may be created", File(e.keys.root, "quarantine").exists())
        assertEquals("DEK file must be untouched", dekHash, Fx.sha256(e.keys.dekFile(d.tag)))

        // The recovered store stays writable from the recovered state.
        val recovered = d.stores.outbox.read(a)!!
        val next = Fx.applied(Fx.add(recovered, 4, 4, "Wal bound four"))
        assertTrue("recovered store must accept a CAS from the recovered state", d.stores.outbox.compareAndSet(a, recovered, next))
        assertEquals(listOf(Fx.opId(1), Fx.opId(2), Fx.opId(4)), ops(d, a))
        d.close()

        Fx.evidence(
            "WAL-BOUND pageSize=$pageSize walBytes=$walLen t4Bytes=${walLen - walLenAfterT3} lastFrameAt=$lastFrame " +
                "damageAt=$damageAt control=ALL_4_TXNS damaged=OPENED lostOnly=T4 sibling=INTACT setAside=NO writable=YES",
        )
    }
}
