package com.penningtonlabs.baileyscart.core.storage

import android.app.Service
import android.content.Intent
import android.os.Binder
import android.os.IBinder
import android.os.Process
import java.io.File

/**
 * Runs in process ":victim". Executes [Scenario] (or an interrupted set-aside) against real encrypted
 * storage and SIGKILLs its own process (Process.killProcess) at the requested crash point.
 */
class VictimService : Service() {
    override fun onBind(intent: Intent): IBinder {
        val root = File(intent.getStringExtra("root")!!)
        val prefix = intent.getStringExtra("prefix")!!
        val uid = intent.getStringExtra("uid")!!
        val point = intent.getStringExtra("point")!!
        val mode = intent.getStringExtra("mode") ?: "scenario"
        // Never re-run: if Android restarts the bound service after the kill, do nothing.
        val started = File(root, "victim.started")
        if (started.exists()) {
            Process.killProcess(Process.myPid())
            return Binder()
        }
        started.writeText("started")
        Thread {
            try {
                if (mode == "setaside") runSetAside(root, prefix, uid, point.toInt()) else runScenario(root, prefix, uid, point)
            } finally {
                Process.killProcess(Process.myPid())
            }
        }.start()
        return Binder()
    }

    /** SIGKILL self and block, so the process dies at this exact point (e.g. inside an open transaction). */
    private fun die(): Nothing {
        Process.killProcess(Process.myPid())
        while (true) Thread.sleep(10_000)
    }

    private fun runScenario(root: File, prefix: String, uid: String, point: String) {
        val keys = KeyManager(root, prefix)
        val store = (SpikeAccountStore.open(applicationContext, keys, FakeVerifiedSession(uid), RecoveryController(keys)) as OpenResult.Opened).store
        val key = Fx.family(store)
        val sentLog = File(root, "sent.log")
        Scenario.seedSibling(store.stores.outbox, store.account) // before crash hooks: does not shift CAS counts
        val pts = Scenario.Points(point) { die() }
        store.stores.txnHook = TxnHook { label -> pts.hit(label) }
        val c = SpikeCoordinator(
            store.stores.outbox,
            key,
            null,
            Fx.E1,
            { op -> Scenario.appendSent(sentLog, op.opId.value); Scenario.RESULTS.getValue(op.opId.value) },
            { pts.hit(it) },
        )
        Scenario.enqueueAll(c) { pts.hit(it) }
        c.drain()
        File(root, "victim.completed").writeText("no crash point reached")
    }

    /** Explicitly acknowledged set-aside, killed after [afterMoves] file moves. */
    private fun runSetAside(root: File, prefix: String, uid: String, afterMoves: Int) {
        val keys = KeyManager(root, prefix)
        val rc = RecoveryController(keys)
        var moves = 0
        rc.afterMove = { if (++moves == afterMoves) die() }
        rc.setAside(keys.accountTag(FakeVerifiedSession(uid))!!, RecoveryAcknowledgement(optedIn = true, confirmed = true))
    }

    override fun toString(): String = "VictimService"
}
