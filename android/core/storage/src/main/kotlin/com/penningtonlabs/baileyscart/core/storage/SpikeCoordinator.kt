package com.penningtonlabs.baileyscart.core.storage

import com.penningtonlabs.baileyscart.core.model.offline.AddOutcome
import com.penningtonlabs.baileyscart.core.model.offline.Dispatch
import com.penningtonlabs.baileyscart.core.model.offline.FamilyEpoch
import com.penningtonlabs.baileyscart.core.model.offline.FamilyKey
import com.penningtonlabs.baileyscart.core.model.offline.FamilyOutbox
import com.penningtonlabs.baileyscart.core.model.offline.OutboxOperation
import com.penningtonlabs.baileyscart.core.model.offline.OutboxStore
import com.penningtonlabs.baileyscart.core.model.offline.ServerErrorCode
import com.penningtonlabs.baileyscart.core.model.offline.Transition

/** Simulated transport outcome (no network exists in the spike). */
sealed interface TransportResult {
    data class Committed(val version: Long, val addOutcome: AddOutcome? = null) : TransportResult
    data class Rejected(val code: ServerErrorCode) : TransportResult
    data object Ambiguous : TransportResult
}

fun interface SpikeTransport {
    fun send(operation: OutboxOperation): TransportResult
}

/** Named crash points (test-only fault injection; no-op by default). */
fun interface CrashPoints {
    fun at(point: String)
}

/**
 * Test-only dispatcher implementing the Q-7 storage invariant over the S2a domain:
 *  1. the IN_FLIGHT state is committed before transport.send (durable before external effect);
 *  2. an outcome transition (which already contains every transitive BLOCKED_DEPENDENCY) is committed
 *     before the next dispatchNext(), so younger operations pass a blocked one only once durable;
 *  3. an Idle result that changed the outbox is committed before anything else.
 */
class SpikeCoordinator(
    private val store: OutboxStore,
    private val key: FamilyKey,
    /** The currently persisted outbox (null = nothing stored yet), e.g. from SpikeStores.recover(). */
    initialStored: FamilyOutbox?,
    epochIfEmpty: FamilyEpoch,
    private val transport: SpikeTransport,
    private val crash: CrashPoints = CrashPoints { },
    private val trace: (String) -> Unit = { },
) {
    private var stored: FamilyOutbox? = initialStored

    var outbox: FamilyOutbox = initialStored ?: FamilyOutbox.empty(key, epochIfEmpty)
        private set

    private fun persist(next: FamilyOutbox, label: String) {
        if (next == stored) return
        check(store.compareAndSet(key, stored, next)) { "CAS lost for $label (concurrent writer or stale view)" }
        stored = next
        outbox = next
        trace("commit $label")
    }

    /** Durably apply a domain transition (enqueue, epoch change, revoke) before returning. */
    fun apply(t: Transition, label: String): Transition {
        if (t is Transition.Applied) persist(t.outbox, label)
        return t
    }

    /** Dispatch at most one operation. Returns false when idle. */
    fun step(): Boolean {
        when (val d = outbox.dispatchNext()) {
            is Dispatch.Idle -> {
                if (d.outbox != outbox) persist(d.outbox, "idle:${d.reason}")
                return false
            }
            is Dispatch.Send -> {
                val op = d.operation
                crash.at("before_inflight_commit")
                persist(d.outbox, "IN_FLIGHT ${op.opId.value}")
                crash.at("after_inflight_commit_before_send")
                trace("send ${op.opId.value}")
                val result = transport.send(op)
                crash.at("after_send_before_outcome_commit")
                val t = when (result) {
                    is TransportResult.Committed -> outbox.recordCommitted(key, op.opId, result.version, result.addOutcome)
                    is TransportResult.Rejected -> outbox.recordRejected(key, op.opId, result.code)
                    TransportResult.Ambiguous -> outbox.recordAmbiguous(key, op.opId)
                }
                check(t is Transition.Applied) { "unexpected outcome transition $t" }
                persist(t.outbox, "outcome ${op.opId.value}")
                crash.at("after_outcome_commit_before_next_dispatch")
                return true
            }
        }
    }

    fun drain(maxSteps: Int = 1000) {
        var n = 0
        while (step()) check(++n < maxSteps) { "drain did not converge" }
    }
}
