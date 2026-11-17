package com.penningtonlabs.baileyscart.core.storage

import android.os.Build
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.penningtonlabs.baileyscart.core.model.offline.AddOutcome
import com.penningtonlabs.baileyscart.core.model.offline.FamilyOutbox
import com.penningtonlabs.baileyscart.core.model.offline.OpId
import com.penningtonlabs.baileyscart.core.model.offline.OpState
import com.penningtonlabs.baileyscart.core.model.offline.RequestIdentity
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/** DUR-1 (WAL + synchronous=FULL on every connection), DUR-2 (causal ordering trace), DUR-5 (latency). */
@RunWith(AndroidJUnit4::class)
class DurabilityTest {
    private val envs = ArrayList<Fx.Env>()
    private fun env(name: String) = Fx.Env(name).also { envs += it }

    @After
    fun cleanup() = envs.forEach { it.cleanup() }

    /** Forces the pool to open reader connections by running slow overlapping SELECTs from several threads. */
    private fun forceReaderConnections(s: SpikeAccountStore, threads: Int = 4) {
        val pool = Executors.newFixedThreadPool(threads)
        val ready = CountDownLatch(threads)
        val done = CountDownLatch(threads)
        repeat(threads) {
            pool.execute {
                ready.countDown()
                ready.await()
                s.supportDb().query("WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < 1500000) SELECT count(*) FROM c").use { it.moveToFirst() }
                done.countDown()
            }
        }
        assertTrue(done.await(120, TimeUnit.SECONDS))
        pool.shutdown()
    }

    private fun readbackAll(phase: String): List<String> {
        val out = ArrayList<String>()
        ConnectionRegistry.connections.forEachIndexed { i, o ->
            val sync = o.connection.executeForLong("PRAGMA synchronous", null, null)
            // A connection last used for read-only statements keeps its read-only-operations flag while idle, so
            // PRAGMA journal_mode may be refused here; journal_mode is asserted through Room on the primary below.
            val journal = runCatching { o.connection.executeForString("PRAGMA journal_mode", null, null) }
            val role = if (ConnectionRegistry.connections.size == 1) "primary(only connection)" else "pooled#$i"
            val temp = runCatching { o.connection.executeForString("PRAGMA temp_store", null, null) }.getOrElse { "n/a" }
            out += "DUR1 $phase conn#$i role=$role synchronous=$sync journal_mode=${journal.getOrElse { "n/a(read-only)" }} " +
                "temp_store=$temp secure_delete=${o.secureDelete} hookTimeSynchronous=${o.synchronousAfterHook} hookTimeTempStore=${o.tempStore}"
        }
        out.forEach(Fx::evidence)
        ConnectionRegistry.connections.forEachIndexed { i, o ->
            val sync = o.connection.executeForLong("PRAGMA synchronous", null, null)
            val journal = runCatching { o.connection.executeForString("PRAGMA journal_mode", null, null) }
            assertEquals("$phase conn#$i synchronous", 2L, sync)
            if (journal.isSuccess) assertEquals("$phase conn#$i journal_mode", "wal", journal.getOrThrow())
            assertEquals("$phase conn#$i temp_store at hook (2=MEMORY)", "2", o.tempStore)
            assertEquals("$phase conn#$i secure_delete", "1", o.secureDelete)
        }
        assertEquals("$phase: single-connection pool", 1, ConnectionRegistry.connections.size)
        return out
    }

    @Test
    fun dur1EveryConnectionIsWalAndFullBeforeAndAfterReopen() {
        val e = env("dur1")
        val lines = ArrayList<String>()
        for (phase in listOf("initial-open", "reopen")) {
            ConnectionRegistry.connections.clear()
            val s = e.opened("demo-dur1")
            // Writer readback BEFORE any spike write transaction: proves onConfigure, not per-txn enforcement.
            lines += readbackAll("$phase-writer-only")
            forceReaderConnections(s)
            val n = ConnectionRegistry.connections.size
            assertEquals("single-connection WAL pool: concurrent reads must not open extra connections", 1, n)
            lines += readbackAll("$phase-after-4-concurrent-readers-$n-connection")
            assertEquals(2L, s.writerSynchronousInTransaction())
            assertEquals("wal", s.journalMode())
            val key = Fx.family(s)
            val o = Fx.applied(Fx.add(FamilyOutbox.empty(key, Fx.E1), 1, 1, "Dur one item"))
            if (phase == "initial-open") assertTrue(s.stores.outbox.compareAndSet(key, null, o))
            lines += readbackAll("$phase-after-write")
            s.close()
        }
        assertEquals("phases x readback points", 6, lines.size)
    }

    /** NC-87 target: a library reconfiguration back to NORMAL is corrected inside every write transaction. */
    @Test
    fun perTransactionEnforcementRestoresFullAfterExternalDowngrade() {
        val e = env("dur1b")
        val s = e.opened("demo-dur1b")
        val key = Fx.family(s)
        s.supportDb().execSQL("PRAGMA synchronous=NORMAL") // simulate a reconfigured writer connection
        assertTrue(s.stores.outbox.compareAndSet(key, null, Fx.applied(Fx.add(FamilyOutbox.empty(key, Fx.E1), 1, 1, "Item"))))
        assertEquals("writer must be FULL after a spike write transaction", 2L, s.writerSynchronousInTransaction())
        s.close()
    }

    @Test
    fun dur2CommitPrecedesSendAndRejectionWithBlockedDependentsPrecedesYoungerDispatch() {
        val e = env("dur2")
        val s = e.opened("demo-dur2")
        val key = Fx.family(s)
        // F-5: sibling family with colliding opIds 1 and 2 must be untouched by the whole scenario.
        val sibling = Scenario.seedSibling(s.stores.outbox, s.account)
        val km = (e.keys.unwrap(s.tag) as UnwrapResult.Ok).key
        val checker = DiskChecker(e.keys.dbFile(s.tag), km.sqlcipherKey)
        val trace = ArrayList<String>()
        val ids = HashMap<OpId, RequestIdentity>()
        val violations = ArrayList<String>()
        var op3Attempts = 0
        val c = SpikeCoordinator(s.stores.outbox, key, null, Fx.E1, { op ->
            violations += checker.checkSend(op, ids)
            trace += "transport.send ${op.opId.value.takeLast(2)} attempt=${op.attempts}"
            when (op.opId.value) {
                Fx.uuid(1) -> TransportResult.Rejected(Fx.REJECT)
                Fx.uuid(3) -> if (++op3Attempts == 1) TransportResult.Ambiguous else TransportResult.Committed(3, AddOutcome.CREATED)
                else -> TransportResult.Committed(4, AddOutcome.CREATED)
            }
        }, trace = { trace += it.replace(Fx.uuid(0).dropLast(2), "") })
        Scenario.enqueueAll(c) { }
        c.drain()
        // Failed-CAS path: a stale expected value must be refused without any write.
        val beforeStale = MigrationFixture.rawOutbox(e.keys.dbFile(s.tag), km.sqlcipherKey)
        assertEquals(false, s.stores.outbox.compareAndSet(key, null, FamilyOutbox.empty(key, Fx.E1)))
        assertEquals(beforeStale, MigrationFixture.rawOutbox(e.keys.dbFile(s.tag), km.sqlcipherKey))
        assertEquals("sibling family untouched", sibling, s.stores.outbox.read(Fx.family(s, Scenario.SIBLING)))
        km.wipe()
        trace.forEachIndexed { i, t -> Fx.evidence("DUR2 #%03d %s".format(i, t)) }
        assertTrue("Q-7 violations: $violations", violations.isEmpty())
        val sends = trace.filter { it.startsWith("transport.send") }.map { it.substringAfter("send ").take(2) }
        assertEquals("FIFO, op2 never sent, op3 retried before op4", listOf("01", "03", "03", "04"), sends)
        val final = c.outbox
        assertEquals(OpState.REJECTED_TERMINAL, final.operation(Fx.opId(1))!!.state)
        assertEquals(OpState.BLOCKED_DEPENDENCY, final.operation(Fx.opId(2))!!.state)
        assertEquals(OpState.COMMITTED, final.operation(Fx.opId(3))!!.state)
        assertEquals(OpState.COMMITTED, final.operation(Fx.opId(4))!!.state)
        s.close()
    }

    @Test
    fun dur5EnqueueCommitLatency() {
        val warmup = 20
        val samples = InstrumentationRegistry.getArguments().getString("dur5Samples")?.toInt() ?: 200
        val e = env("dur5")
        val s = e.opened("demo-dur5")
        val key = Fx.family(s)
        var o: FamilyOutbox? = null
        val nanos = ArrayList<Long>()
        for (i in 1..(warmup + samples)) {
            val base = o ?: FamilyOutbox.empty(key, Fx.E1)
            val next = Fx.applied(Fx.add(base, i.toLong(), i.toLong(), "Latency item $i"))
            val t0 = System.nanoTime()
            assertTrue(s.stores.outbox.compareAndSet(key, o, next))
            val dt = System.nanoTime() - t0
            if (i > warmup) nanos += dt
            o = next
        }
        s.close()
        val ms = nanos.map { it / 1_000_000.0 }.sorted()
        fun pct(p: Double) = ms[((p * ms.size).toInt()).coerceAtMost(ms.size - 1)]
        val mean = ms.average()
        val sd = kotlin.math.sqrt(ms.map { (it - mean) * (it - mean) }.average())
        Fx.evidence(
            "DUR5 device=${Build.MODEL} api=${Build.VERSION.SDK_INT} abi=${Build.SUPPORTED_ABIS.first()} warmup=$warmup n=${ms.size} " +
                "p50=%.2fms p95=%.2fms p99=%.2fms max=%.2fms mean=%.2fms sd=%.2fms outboxSizeEnd=%d proposedP95Target=100ms".format(
                    pct(0.50), pct(0.95), pct(0.99), ms.last(), mean, sd, warmup + samples,
                ),
        )
    }
}
