package com.penningtonlabs.baileyscart.core.storage

import com.penningtonlabs.baileyscart.core.model.offline.Category
import com.penningtonlabs.baileyscart.core.model.offline.FamilyKey
import com.penningtonlabs.baileyscart.core.model.offline.FamilyOutbox
import com.penningtonlabs.baileyscart.core.model.offline.FamilyOutboxRestore
import com.penningtonlabs.baileyscart.core.model.offline.OpId
import com.penningtonlabs.baileyscart.core.model.offline.OpState
import com.penningtonlabs.baileyscart.core.model.offline.OutboxOperation
import com.penningtonlabs.baileyscart.core.model.offline.OutboxStore
import com.penningtonlabs.baileyscart.core.model.offline.RequestIdentity
import net.zetetic.database.sqlcipher.SQLiteDatabase
import java.io.File
import java.io.FileOutputStream

/**
 * DUR-2/DUR-3 scenario (fictional): op1 add X, op2 edit X (depends on op1), op3 add Y, op4 add Z.
 * Server script: op1 terminally rejected (op2 must become BLOCKED_DEPENDENCY), op3 and op4 committed.
 */
object Scenario {
    val RESULTS: Map<String, TransportResult> = mapOf(
        Fx.uuid(1) to TransportResult.Rejected(Fx.REJECT),
        Fx.uuid(3) to TransportResult.Committed(3, com.penningtonlabs.baileyscart.core.model.offline.AddOutcome.CREATED),
        Fx.uuid(4) to TransportResult.Committed(4, com.penningtonlabs.baileyscart.core.model.offline.AddOutcome.CREATED),
    )

    /** Crash points: name#occurrence. "cas#N" = inside the Nth CAS transaction, rows written, before COMMIT. */
    val POINTS = listOf(
        "after_enqueue_commit#1",
        "before_inflight_commit#1",
        "after_inflight_commit_before_send#1",
        "after_send_before_outcome_commit#1",
        "cas#6",
        "after_outcome_commit_before_next_dispatch#1",
        "after_send_before_outcome_commit#2",
    )

    /** Sends expected (in order) before the crash, per point. */
    val SENT_BEFORE_CRASH = mapOf(
        "after_enqueue_commit#1" to listOf<String>(),
        "before_inflight_commit#1" to listOf(),
        "after_inflight_commit_before_send#1" to listOf(),
        "after_send_before_outcome_commit#1" to listOf(Fx.uuid(1)),
        "cas#6" to listOf(Fx.uuid(1)),
        "after_outcome_commit_before_next_dispatch#1" to listOf(Fx.uuid(1)),
        "after_send_before_outcome_commit#2" to listOf(Fx.uuid(1), Fx.uuid(3)),
    )

    class Killed : RuntimeException("simulated death")

    const val SIBLING = "demo-fam-sibling"

    /** F-5: a sibling family in the same account holding the SAME opIds 1 and 2 (different payloads). */
    fun seedSibling(store: OutboxStore, account: com.penningtonlabs.baileyscart.core.model.offline.AccountKey): FamilyOutbox {
        val k = FamilyKey(account, com.penningtonlabs.baileyscart.core.model.offline.FamilyId.of(SIBLING)!!)
        val o1 = Fx.applied(Fx.add(FamilyOutbox.empty(k, Fx.E1), 1, 900, "Sibling one"))
        check(store.compareAndSet(k, null, o1))
        val o2 = Fx.applied(Fx.add(o1, 2, 901, "Sibling two"))
        check(store.compareAndSet(k, o1, o2))
        return o2
    }

    fun enqueueAll(c: SpikeCoordinator, crash: (String) -> Unit) {
        var o = c.outbox
        o = c.apply(Fx.add(o, 1, 1, Fx.SENTINEL_ITEM), "enqueue 1").let { (it as com.penningtonlabs.baileyscart.core.model.offline.Transition.Applied).outbox }
        o = c.apply(Fx.edit(o, 2, 1, "Oat milk (barista)"), "enqueue 2").let { (it as com.penningtonlabs.baileyscart.core.model.offline.Transition.Applied).outbox }
        o = c.apply(Fx.add(o, 3, 2, Fx.SENTINEL_ITEM_2, Category.PRODUCE), "enqueue 3").let { (it as com.penningtonlabs.baileyscart.core.model.offline.Transition.Applied).outbox }
        c.apply(Fx.add(o, 4, 3, "Rye bread", Category.DRY), "enqueue 4")
        crash("after_enqueue_commit")
    }

    /** Counts occurrences and fires [onHit] at the configured "name#n". */
    class Points(private val target: String, private val onHit: () -> Unit) {
        private val seen = HashMap<String, Int>()
        fun hit(name: String) {
            val n = (seen[name] ?: 0) + 1
            seen[name] = n
            if ("$name#$n" == target) onHit()
        }
    }

    /** Independent in-memory model of committed state (atomic CAS map) used to predict recovery. */
    class MemoryStore : OutboxStore {
        val committed = HashMap<FamilyKey, FamilyOutbox>()
        var beforeCommit: () -> Unit = { }
        override fun read(key: FamilyKey): FamilyOutbox? = committed[key]
        override fun compareAndSet(key: FamilyKey, expected: FamilyOutbox?, updated: FamilyOutbox): Boolean {
            if (committed[key] != expected) return false
            beforeCommit()
            committed[key] = updated
            return true
        }
    }

    /** Model prediction for a crash at [point]: (recovered outbox, sends before crash). */
    fun predict(key: FamilyKey, point: String): Pair<FamilyOutbox?, List<String>> {
        val mem = MemoryStore()
        val sent = ArrayList<String>()
        val pts = Points(point) { throw Killed() }
        mem.beforeCommit = { pts.hit("cas") }
        val c = SpikeCoordinator(mem, key, null, Fx.E1, { op -> sent += op.opId.value; RESULTS.getValue(op.opId.value) }, { pts.hit(it) })
        try {
            enqueueAll(c) { pts.hit(it) }
            c.drain()
        } catch (_: Killed) {
            // simulated death
        }
        val stored = mem.committed[key] ?: return null to sent
        val restored = (FamilyOutbox.restore(key, stored.currentEpoch, stored.access, stored.operations) as FamilyOutboxRestore.Restored).outbox
        return restored to sent
    }

    /** No-crash final state from the model. */
    fun finalState(key: FamilyKey): FamilyOutbox {
        val mem = MemoryStore()
        val c = SpikeCoordinator(mem, key, null, Fx.E1, { op -> RESULTS.getValue(op.opId.value) })
        enqueueAll(c) { }
        c.drain()
        return c.outbox
    }

    fun appendSent(log: File, opId: String) {
        FileOutputStream(log, true).use { it.write("$opId\n".toByteArray()); it.fd.sync() }
    }

    fun readSent(log: File): List<String> = if (log.exists()) log.readLines().filter { it.isNotBlank() } else emptyList()
}

/**
 * Independent durability checker: opens a NEW read-only SQLCipher connection on every call and asserts
 * the Q-7 invariants for a send of [op] against what is actually committed on disk.
 */
class DiskChecker(private val dbFile: File, private val key: ByteArray, private val familyId: String = Fx.SENTINEL_FAMILY) {
    data class Row(val opId: String, val seq: Long, val state: String, val dependsOn: String?)

    fun rows(): List<Row> {
        SpikeAccountStore.ensureNativeLoaded()
        val db = SQLiteDatabase.openDatabase(dbFile.absolutePath, key, null, SQLiteDatabase.OPEN_READONLY, SpikeAccountStore.ThrowingErrorHandler, null)
        try {
            return db.rawQuery("SELECT opId, sequence, state, dependsOn FROM outbox WHERE familyId = ? ORDER BY sequence", arrayOf(familyId)).use { c ->
                buildList { while (c.moveToNext()) add(Row(c.getString(0), c.getLong(1), c.getString(2), if (c.isNull(3)) null else c.getString(3))) }
            }
        } finally {
            db.close()
        }
    }

    /** Returns a list of violations (empty = OK). */
    fun checkSend(op: OutboxOperation, identities: MutableMap<OpId, RequestIdentity>): List<String> {
        val v = ArrayList<String>()
        val rows = rows()
        val byId = rows.associateBy { it.opId }
        val me = byId[op.opId.value]
        if (me == null || me.state != OpState.IN_FLIGHT.name) v += "send ${op.opId.value} but disk state is ${me?.state}"
        if (rows.count { it.state == OpState.IN_FLIGHT.name } > 1) v += "more than one IN_FLIGHT on disk"
        rows.filter { it.seq < op.sequence && it.state == OpState.RETRY_WAIT.name }.forEach { v += "younger send overtakes RETRY_WAIT ${it.opId}" }
        val failed = setOf("REJECTED_TERMINAL", "BLOCKED_DEPENDENCY", "QUARANTINED_AGED", "QUARANTINED_STALE_EPOCH", "COALESCED_NO_OP")
        rows.filter { it.dependsOn != null && byId[it.dependsOn]?.state in failed }.forEach {
            if (it.state != OpState.BLOCKED_DEPENDENCY.name && it.state !in failed) v += "dependent ${it.opId} of failed op not durably BLOCKED (${it.state})"
        }
        val prior = identities.putIfAbsent(op.opId, op.requestIdentity)
        if (prior != null && prior != op.requestIdentity) v += "retry changed request identity for ${op.opId.value}"
        return v
    }
}
