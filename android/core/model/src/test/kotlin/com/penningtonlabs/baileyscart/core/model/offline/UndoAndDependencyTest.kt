package com.penningtonlabs.baileyscart.core.model.offline

import com.penningtonlabs.baileyscart.core.model.offline.Fx.A1
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

/** PL-PP-WP02-04 (delete/Undo causal order) and PL-PP-WP02-05 (fail-closed blocked dependencies). */
class UndoAndDependencyTest {
    private val rejected = ServerErrorCode("DUPLICATE_NAME_EXISTS")

    // ---- PL-PP-WP02-04 -----------------------------------------------------------------

    @Test fun unsentDeleteAndUndoCoalesceToRecordedNoOp() {
        val id = item(1)
        var o = FamilyOutbox.empty(A1, E1)
            .q(op(1), add(item(9), "Bread"))
            .q(op(2), delete(id))
            .q(op(3), add(item(10), "Rice"))
        o = o.q(op(4), undo(id, op(2)))
        assertEquals(OpState.COALESCED_NO_OP, o.state(op(2)))
        assertEquals(OpState.COALESCED_NO_OP, o.state(op(4))) // recorded, not silently dropped
        // Other queued operations keep their order, and neither the delete nor the undo is transmitted.
        val sent = mutableListOf<OpId>()
        while (true) {
            val d = o.dispatchNext()
            if (d !is Dispatch.Send) break
            sent += d.operation.opId
            o = d.outbox.recordCommitted(A1, d.operation.opId, 1, AddOutcome.CREATED).applied()
        }
        assertEquals(listOf(op(1), op(3)), sent)
    }

    @Test fun deleteInFlightIsNotCoalescedAndUndoWaitsBehindIt() {
        val id = item(1)
        val (inFlight, _) = FamilyOutbox.empty(A1, E1).q(op(1), delete(id)).dispatchNext().sent()
        val o = inFlight.q(op(2), undo(id, op(1)))
        assertEquals(OpState.IN_FLIGHT, o.state(op(1)))
        assertEquals(OpState.PENDING, o.state(op(2)))
        o.dispatchNext().idle(IdleReason.IN_FLIGHT_BUSY)
        val (_, u) = o.recordCommitted(A1, op(1), 2).applied().dispatchNext().sent()
        assertEquals(op(2), u.opId)
    }

    @Test fun ambiguouslySentDeleteIsNeverTreatedAsUnsent() {
        val id = item(1)
        val o = FamilyOutbox.empty(A1, E1).q(op(1), delete(id)).dispatchNext().sent().first
            .recordAmbiguous(A1, op(1)).applied()
            .q(op(2), undo(id, op(1)))
        // Negative: the delete may have reached the server, so there is no coalescing.
        assertEquals(OpState.RETRY_WAIT, o.state(op(1)))
        assertEquals(OpState.PENDING, o.state(op(2)))
        assertEquals(op(1), o.dispatchNext().sent().second.opId) // the delete is retried first, undo after
    }

    @Test fun committedDeleteIsNeverErasedByUndo() {
        val id = item(1)
        val o = FamilyOutbox.empty(A1, E1).q(op(1), delete(id)).sendAndCommit(5).first.q(op(2), undo(id, op(1)))
        assertEquals(OpState.COMMITTED, o.state(op(1)))
        assertEquals(OpState.PENDING, o.state(op(2)))
    }

    @Test fun noCoalescingWhenALaterOperationTargetsTheSameItem() {
        val id = item(1)
        val o = FamilyOutbox.empty(A1, E1).q(op(1), delete(id)).q(op(2), edit(id, "Changed")).q(op(3), undo(id, op(1)))
        assertEquals(OpState.PENDING, o.state(op(1)))
        assertEquals(OpState.PENDING, o.state(op(3)))
        assertEquals(op(1), o.operation(op(3))!!.dependsOn)
    }

    @Test fun undoOfRejectedDeleteIsBlocked() {
        val id = item(1)
        val o = FamilyOutbox.empty(A1, E1).q(op(1), delete(id)).dispatchNext().sent().first
            .q(op(2), undo(id, op(1)))
            .recordRejected(A1, op(1), ServerErrorCode("ITEM_NOT_FOUND")).applied()
        assertEquals(OpState.BLOCKED_DEPENDENCY, o.state(op(2)))
        o.dispatchNext().idle(IdleReason.EMPTY)
    }

    // ---- PL-PP-WP02-05 -----------------------------------------------------------------

    @Test fun terminalAddFailureBlocksDependentsTransitively() {
        val id = item(1)
        var o = FamilyOutbox.empty(A1, E1)
            .q(op(1), add(id, "Milk"))
            .q(op(2), edit(id, "Oat milk"))
            .q(op(3), add(item(2), "Eggs")) // unrelated
            .q(op(4), delete(id))
        o = o.dispatchNext().sent().first.recordRejected(A1, op(1), rejected).applied()
        o = o.q(op(5), undo(id, op(4)))
        assertEquals(OpState.REJECTED_TERMINAL, o.state(op(1)))
        assertEquals(OpState.BLOCKED_DEPENDENCY, o.state(op(2)))
        assertEquals(OpState.BLOCKED_DEPENDENCY, o.state(op(4)))
        assertEquals(OpState.BLOCKED_DEPENDENCY, o.state(op(5))) // depends on a blocked delete
        // The unrelated operation proceeds; blocked ones are never dispatched or retargeted.
        val (o2, next) = o.dispatchNext().sent()
        assertEquals(op(3), next.opId)
        o2.recordCommitted(A1, op(3), 1, AddOutcome.CREATED).applied().dispatchNext().idle(IdleReason.EMPTY)
        assertEquals(listOf(op(1), op(2), op(4), op(5)), o.attention.map { it.opId })
    }

    @Test fun addSatisfiedByExistingItemBlocksDependentsWithoutRetargeting() {
        val id = item(1)
        val o = FamilyOutbox.empty(A1, E1)
            .q(op(1), add(id, "Milk"))
            .q(op(2), edit(id, null, Category.DAIRY))
            .dispatchNext().sent().first
            .recordCommitted(A1, op(1), 7, AddOutcome.SATISFIED_BY_EXISTING_ITEM).applied()
        assertEquals(OpState.COMMITTED, o.state(op(1)))
        assertEquals(OpState.BLOCKED_DEPENDENCY, o.state(op(2)))
        assertEquals(id, o.operation(op(2))!!.command.itemId) // never re-pointed to the existing item
        o.dispatchNext().idle(IdleReason.EMPTY)
    }

    @Test fun dependentEnqueuedAfterFailureIsBlockedImmediately() {
        val id = item(1)
        val o = FamilyOutbox.empty(A1, E1).q(op(1), add(id, "Milk")).dispatchNext().sent().first
            .recordRejected(A1, op(1), rejected).applied()
            .q(op(2), edit(id, "Oat milk"))
        assertEquals(OpState.BLOCKED_DEPENDENCY, o.state(op(2)))
    }

    @Test fun blockedStateHasNoAutomaticRecovery() {
        val id = item(1)
        var o = FamilyOutbox.empty(A1, E1).q(op(1), add(id, "Milk")).q(op(2), edit(id, "X"))
        o = o.dispatchNext().sent().first.recordRejected(A1, op(1), rejected).applied()
        // No outcome can move a blocked operation; every transition attempt is refused.
        assertEquals(Refusal.CONFLICTING_TRANSITION, o.recordCommitted(A1, op(2), 1).refusal())
        assertEquals(Refusal.CONFLICTING_TRANSITION, o.recordAmbiguous(A1, op(2)).refusal())
        assertEquals(Refusal.CONFLICTING_TRANSITION, o.recordRejected(A1, op(2), rejected).refusal())
        assertTrue(o.advanceEpoch(Fx.E2).applied().state(op(2)) == OpState.BLOCKED_DEPENDENCY)
        // D-9: aging is inactive. No transition ever yields QUARANTINED_AGED.
        assertTrue(o.operations.none { it.state == OpState.QUARANTINED_AGED })
    }
}
