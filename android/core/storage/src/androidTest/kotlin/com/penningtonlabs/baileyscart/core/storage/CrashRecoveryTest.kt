package com.penningtonlabs.baileyscart.core.storage

import android.app.ActivityManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.os.IBinder
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.penningtonlabs.baileyscart.core.model.offline.FamilyOutbox
import com.penningtonlabs.baileyscart.core.model.offline.OpId
import com.penningtonlabs.baileyscart.core.model.offline.OutboxOperation
import com.penningtonlabs.baileyscart.core.model.offline.RequestIdentity
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** DUR-3 (and set-aside interruption): real SIGKILL of a separate process at named crash points. */
@RunWith(AndroidJUnit4::class)
class CrashRecoveryTest {

    private val runs: Int = InstrumentationRegistry.getArguments().getString("dur3Runs")?.toInt() ?: 50

    /** Bind the victim, wait for its process to die, unbind before any restart, wait until the process is gone. */
    private fun runVictim(extras: Map<String, String>) {
        val ctx = Fx.context
        val died = CountDownLatch(1)
        val conn = object : ServiceConnection {
            override fun onServiceConnected(name: ComponentName, service: IBinder) = Unit
            override fun onServiceDisconnected(name: ComponentName) = died.countDown()
            override fun onBindingDied(name: ComponentName) = died.countDown()
        }
        val intent = Intent(ctx, VictimService::class.java)
        extras.forEach { (k, v) -> intent.putExtra(k, v) }
        assertTrue(ctx.bindService(intent, conn, Context.BIND_AUTO_CREATE))
        assertTrue("victim did not die within 60 s", died.await(60, TimeUnit.SECONDS))
        ctx.unbindService(conn)
        val am = ctx.getSystemService(ActivityManager::class.java)
        val deadline = System.currentTimeMillis() + 10_000
        while (am.runningAppProcesses.orEmpty().any { it.processName.endsWith(":victim") }) {
            check(System.currentTimeMillis() < deadline) { "victim process still alive" }
            Thread.sleep(50)
        }
    }

    private data class Essence(val opId: String, val seq: Long, val state: String, val epoch: Long, val identity: RequestIdentity, val dependsOn: OpId?, val version: Long?, val rejection: String?)

    private fun essence(o: FamilyOutbox) = o.operations.map {
        Essence(it.opId.value, it.sequence, it.state.name, it.epoch.value, it.requestIdentity, it.dependsOn, it.committedVersion, it.rejection?.code)
    }

    @Test
    fun processKillAtEveryCrashPointRecoversModelStateAndConverges() {
        val tally = LinkedHashMap<String, Int>()
        for (point in Scenario.POINTS) {
            var passed = 0
            repeat(runs) { r ->
                val env = Fx.Env("dur3")
                val uid = "demo-dur3-$r"
                try {
                    runVictim(mapOf("root" to env.root.path, "prefix" to env.prefix, "uid" to uid, "point" to point))
                    assertFalse("crash point $point not reached", File(env.root, "victim.completed").exists())
                    val store = env.opened(uid)
                    val key = Fx.family(store)
                    val siblingKey = Fx.family(store, Scenario.SIBLING)
                    val sibling = store.stores.outbox.read(siblingKey)
                    assertEquals("sibling family intact after crash at $point run $r", 2, sibling?.operations?.size)
                    assertEquals(listOf(Fx.uuid(1), Fx.uuid(2)), sibling!!.operations.map { it.opId.value })
                    val recovered = store.stores.outbox.read(key)
                    val (predicted, predictedSent) = Scenario.predict(key, point)
                    assertEquals("recovered state at $point run $r", predicted?.let(::essence), recovered?.let(::essence))
                    assertEquals("sends before crash at $point run $r", predictedSent, Scenario.readSent(File(env.root, "sent.log")))

                    // Continue from the recovered state with an idempotent server and the independent checker.
                    val keyMat = (env.keys.unwrap(store.tag) as UnwrapResult.Ok).key
                    val checker = DiskChecker(env.keys.dbFile(store.tag), keyMat.sqlcipherKey)
                    val ids = HashMap<OpId, RequestIdentity>()
                    recovered?.operations?.forEach { ids[it.opId] = it.requestIdentity }
                    val violations = ArrayList<String>()
                    val start = store.stores.recover(key)
                    val c = TestOutboxCoordinator(store.stores.outbox, key, start, Fx.E1, { op: OutboxOperation ->
                        violations += checker.checkSend(op, ids)
                        Scenario.RESULTS.getValue(op.opId.value)
                    })
                    c.drain()
                    keyMat.wipe()
                    assertTrue("Q-7 violations at $point run $r: $violations", violations.isEmpty())
                    assertEquals("converged final state at $point run $r", essence(Scenario.finalState(key)), essence(c.outbox))
                    assertEquals("sibling unchanged after convergence at $point run $r", sibling, store.stores.outbox.read(siblingKey))
                    store.close()
                    passed++
                } finally {
                    env.cleanup()
                }
            }
            tally[point] = passed
        }
        tally.forEach { (p, n) -> Fx.evidence("DUR3 point=$p passed=$n/$runs") }
        assertEquals("all crash points executed", Scenario.POINTS.size, tally.size)
        tally.values.forEach { assertEquals(runs, it) }
    }

    /** Interrupted explicitly-acknowledged set-aside resumes idempotently; nothing is deleted or recreated. */
    @Test
    fun interruptedSetAsideResumesWithoutLoss() {
        val setAsideRuns = InstrumentationRegistry.getArguments().getString("setAsideRuns")?.toInt() ?: 5
        for (afterMoves in 1..3) repeat(setAsideRuns) { r ->
            val env = Fx.Env("setaside")
            val uid = "demo-setaside-$r"
            try {
                val store = env.opened(uid)
                val key = Fx.family(store)
                store.stores.outbox.compareAndSet(key, null, Fx.applied(Fx.add(FamilyOutbox.empty(key, Fx.E1), 1, 1, Fx.SENTINEL_ITEM)))
                store.close()
                val tag = store.tag
                val before = (Fx.files(env.keys.dbFile(tag)) + env.keys.dekFile(tag) + env.keys.createdMarker(tag)).filter { it.exists() }.associate { it.name to Fx.sha256(it) }
                assertTrue("non-vacuous: db and dek present", before.keys.any { it.endsWith(".db") } && before.keys.any { it.endsWith(".dek") })
                runVictim(mapOf("root" to env.root.path, "prefix" to env.prefix, "uid" to uid, "point" to "$afterMoves", "mode" to "setaside"))
                assertTrue("marker must survive the interruption", env.recovery.pending(tag))
                assertEquals(OpenResult.Locked(LockReason.RECOVERY_PENDING), env.open(uid))
                val done = env.recovery.resume(tag) as SetAsideResult.Done
                val after = done.quarantineDir.listFiles()!!.filter { it.name in before.keys }.associate { it.name to Fx.sha256(it) }
                assertEquals("every file moved byte-identical, none lost (afterMoves=$afterMoves)", before, after)
                assertTrue("KEK alias preserved", env.keys.aliasExists(store.keyAlias))
                assertFalse(env.recovery.pending(tag))
            } finally {
                env.cleanup()
            }
        }
        Fx.evidence("SETASIDE interrupted after 1..3 moves x $setAsideRuns runs: all resumed byte-identical")
    }
}
