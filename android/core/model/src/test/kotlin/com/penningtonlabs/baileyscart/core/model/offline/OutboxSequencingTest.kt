package com.penningtonlabs.baileyscart.core.model.offline

import com.penningtonlabs.baileyscart.core.model.offline.Fx.A1
import com.penningtonlabs.baileyscart.core.model.offline.Fx.A2
import com.penningtonlabs.baileyscart.core.model.offline.Fx.B1
import com.penningtonlabs.baileyscart.core.model.offline.Fx.E1
import com.penningtonlabs.baileyscart.core.model.offline.Fx.add
import com.penningtonlabs.baileyscart.core.model.offline.Fx.delete
import com.penningtonlabs.baileyscart.core.model.offline.Fx.edit
import com.penningtonlabs.baileyscart.core.model.offline.Fx.item
import com.penningtonlabs.baileyscart.core.model.offline.Fx.op
import com.penningtonlabs.baileyscart.core.model.offline.Fx.undo
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** PL-PP-WP02-02 (FIFO, one in flight, causal order) and PL-PP-WP02-03 (retry identity, idempotency). */
class OutboxSequencingTest {

    // ---- PL-PP-WP02-02 -----------------------------------------------------------------

    @Test fun strictFifoWithAtMostOneInFlightPerFamily() {
        var o = FamilyOutbox.empty(A1, E1)
            .q(op(1), add(item(1), "Milk"))
            .q(op(2), add(item(2), "Eggs"))
            .q(op(3), add(item(3), "Rice"))
        val (o1, first) = o.dispatchNext().sent()
        assertEquals(op(1), first.opId)
        // Negative: no second dispatch while one is in flight.
        o = o1.dispatchNext().idle(IdleReason.IN_FLIGHT_BUSY)
        assertEquals(1, o.operations.count { it.state == OpState.IN_FLIGHT })
        o = o.recordCommitted(A1, op(1), 1, AddOutcome.CREATED).applied()
        val (o2, second) = o.dispatchNext().sent()
        assertEquals(op(2), second.opId)
        val (o3, third) = o2.recordCommitted(A1, op(2), 1, AddOutcome.CREATED).applied().dispatchNext().sent()
        assertEquals(op(3), third.opId)
        o3.recordCommitted(A1, op(3), 1, AddOutcome.CREATED).applied().dispatchNext().idle(IdleReason.EMPTY)
    }

    @Test fun addThenEditAndDeleteThenUndoKeepCausalOrder() {
        val id = item(1)
        var o = FamilyOutbox.empty(A1, E1)
            .q(op(1), add(id, "Milk"))
            .q(op(2), edit(id, "Oat milk"))
            .q(op(3), delete(id))
        val sentOrder = mutableListOf<OpId>()
        repeat(3) {
            val (next, sent) = o.sendAndCommit(version = (it + 1).toLong())
            sentOrder += sent.opId
            o = next
        }
        // Undo after the delete committed is a separate causally ordered command.
        o = o.q(op(4), undo(id, op(3)))
        val (_, u) = o.dispatchNext().sent()
        sentOrder += u.opId
        assertEquals(listOf(op(1), op(2), op(3), op(4)), sentOrder)
        assertEquals(op(3), u.dependsOn)
    }

    @Test fun familiesAndAccountsAreIndependentQueues() {
        val a1 = FamilyOutbox.empty(A1, E1).q(op(1), add(item(1), "Milk"))
        val a2 = FamilyOutbox.empty(A2, E1).q(op(2), add(item(2), "Milk"))
        val b1 = FamilyOutbox.empty(B1, E1).q(op(3), add(item(3), "Milk"))
        val (a1s, _) = a1.dispatchNext().sent()
        // Each scope has its own single in-flight slot; one family's in-flight op does not block another.
        a2.dispatchNext().sent()
        b1.dispatchNext().sent()
        a1s.dispatchNext().idle(IdleReason.IN_FLIGHT_BUSY)
        // Negative: an operation for another scope is refused, including the same family id under another account.
        assertEquals(Refusal.SCOPE_MISMATCH, a1.enqueue(op(9), A2, E1, add(item(9), "X")).refusal())
        assertEquals(Refusal.SCOPE_MISMATCH, a1.enqueue(op(9), B1, E1, add(item(9), "X")).refusal())
        assertEquals(Refusal.SCOPE_MISMATCH, a1s.recordCommitted(B1, op(1), 1, AddOutcome.CREATED).refusal())
    }

    @Test fun retryWaitHeadIsNeverOvertaken() {
        var o = FamilyOutbox.empty(A1, E1).q(op(1), add(item(1), "Milk")).q(op(2), add(item(2), "Eggs"))
        o = o.dispatchNext().sent().first.recordAmbiguous(A1, op(1)).applied()
        val (_, next) = o.dispatchNext().sent()
        assertEquals(op(1), next.opId) // the retry goes first, not op 2
    }

    // ---- PL-PP-WP02-03 -----------------------------------------------------------------

    @Test fun ambiguousFailureRetriesIdenticalRequest() {
        val id = item(1)
        var o = FamilyOutbox.empty(A1, E1).q(op(1), add(id, "Milk", Category.DAIRY))
        val (o1, first) = o.dispatchNext().sent()
        o = o1.recordAmbiguous(A1, op(1)).applied()
        assertEquals(OpState.RETRY_WAIT, o.state(op(1)))
        val (o2, retry) = o.dispatchNext().sent()
        assertEquals(first.requestIdentity, retry.requestIdentity) // same opId, key, epoch, item, command, payload
        assertEquals(2, retry.attempts)
        assertTrue(retry.dispatched)
        // Negative: exactly one logical operation exists; no new opId was created.
        assertEquals(1, o2.operations.size)
        o = o2.recordCommitted(A1, op(1), 1, AddOutcome.CREATED).applied()
        assertEquals(OpState.COMMITTED, o.state(op(1)))
    }

    @Test fun duplicateEnqueueAndAcknowledgmentAreIdempotent() {
        val cmd = add(item(1), "Milk")
        var o = FamilyOutbox.empty(A1, E1).q(op(1), cmd)
        assertTrue(o.enqueue(op(1), A1, E1, cmd) is Transition.Unchanged)
        o = o.dispatchNext().sent().first.recordCommitted(A1, op(1), 3, AddOutcome.CREATED).applied()
        assertTrue(o.recordCommitted(A1, op(1), 3, AddOutcome.CREATED) is Transition.Unchanged)
        // Negative: a conflicting duplicate acknowledgment is refused.
        assertEquals(Refusal.CONFLICTING_TRANSITION, o.recordCommitted(A1, op(1), 4, AddOutcome.CREATED).refusal())
        assertEquals(Refusal.CONFLICTING_TRANSITION, o.recordRejected(A1, op(1), ServerErrorCode("VALIDATION_FAILED")).refusal())
    }

    @Test fun sameOpIdWithDifferentPayloadOrScopeIsRefused() {
        val o = FamilyOutbox.empty(A1, E1).q(op(1), add(item(1), "Milk"))
        assertEquals(Refusal.PAYLOAD_MISMATCH, o.enqueue(op(1), A1, E1, add(item(1), "Milk ", Category.DAIRY)).refusal())
        assertEquals(Refusal.PAYLOAD_MISMATCH, o.enqueue(op(1), A1, E1, add(item(1), "Eggs")).refusal())
        assertEquals(Refusal.PAYLOAD_MISMATCH, o.enqueue(op(1), A1, E1, delete(item(1))).refusal())
        assertEquals(Refusal.SCOPE_MISMATCH, o.enqueue(op(1), A2, E1, add(item(1), "Milk")).refusal())
    }

    @Test fun outcomesRequireTheOperationToBeInFlight() {
        val o = FamilyOutbox.empty(A1, E1).q(op(1), add(item(1), "Milk"))
        assertEquals(Refusal.CONFLICTING_TRANSITION, o.recordCommitted(A1, op(1), 1, AddOutcome.CREATED).refusal())
        assertEquals(Refusal.CONFLICTING_TRANSITION, o.recordAmbiguous(A1, op(1)).refusal())
        assertEquals(Refusal.UNKNOWN_OPERATION, o.recordRejected(A1, op(99), ServerErrorCode("X")).refusal())
        // An add acknowledgment must state how the add was satisfied; other commands must not.
        val inFlight = o.dispatchNext().sent().first
        assertEquals(Refusal.INVALID_INPUT, inFlight.recordCommitted(A1, op(1), 1, null).refusal())
    }

    @Test fun invalidCommandsAndItemIdReuseAreRefused() {
        val o = FamilyOutbox.empty(A1, E1).q(op(1), add(item(1), "Milk"))
        assertEquals(Refusal.INVALID_INPUT, o.enqueue(op(2), A1, E1, add(item(1), "Other")).refusal())
        assertEquals(Refusal.INVALID_INPUT, o.enqueue(op(3), A1, E1, ItemCommand.Edit(item(1), null, null)).refusal())
        assertEquals(Refusal.UNKNOWN_OPERATION, o.enqueue(op(4), A1, E1, undo(item(1), op(1))).refusal()) // op 1 is not a delete
    }

    @Test fun restoreTreatsInFlightAsAmbiguousAndValidatesInvariants() {
        val o = FamilyOutbox.empty(A1, E1).q(op(1), add(item(1), "Milk")).q(op(2), add(item(2), "Eggs"))
        val inFlight = o.dispatchNext().sent().first
        val restored = (FamilyOutbox.restore(A1, E1, ScopeAccess.ACTIVE, inFlight.operations) as FamilyOutboxRestore.Restored).outbox
        assertEquals(OpState.RETRY_WAIT, restored.state(op(1)))
        assertEquals(op(1), restored.dispatchNext().sent().second.opId)
        // The next sequence continues after the restored maximum.
        val more = restored.q(op(3), add(item(3), "Rice"))
        assertEquals(3L, more.operation(op(3))!!.sequence)
        // Negative: invariant violations are refused as corrupt.
        val foreign = inFlight.operations.map { it.copy(key = A2) }
        assertEquals(FamilyOutboxRestore.Corrupt, FamilyOutbox.restore(A1, E1, ScopeAccess.ACTIVE, foreign))
        val twoInFlight = inFlight.operations.map { it.copy(state = OpState.IN_FLIGHT) }
        assertEquals(FamilyOutboxRestore.Corrupt, FamilyOutbox.restore(A1, E1, ScopeAccess.ACTIVE, twoInFlight))
        val dupSeq = inFlight.operations.map { it.copy(sequence = 1) }
        assertEquals(FamilyOutboxRestore.Corrupt, FamilyOutbox.restore(A1, E1, ScopeAccess.ACTIVE, dupSeq))
    }
}
