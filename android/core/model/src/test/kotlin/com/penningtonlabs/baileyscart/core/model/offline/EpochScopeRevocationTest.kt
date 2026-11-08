package com.penningtonlabs.baileyscart.core.model.offline

import com.penningtonlabs.baileyscart.core.model.offline.Fx.A1
import com.penningtonlabs.baileyscart.core.model.offline.Fx.E1
import com.penningtonlabs.baileyscart.core.model.offline.Fx.E2
import com.penningtonlabs.baileyscart.core.model.offline.Fx.add
import com.penningtonlabs.baileyscart.core.model.offline.Fx.edit
import com.penningtonlabs.baileyscart.core.model.offline.Fx.item
import com.penningtonlabs.baileyscart.core.model.offline.Fx.op
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** PL-PP-WP02-06 (epoch isolation, no re-tagging) and PL-PP-WP02-11 (D1 portion: revocation fails closed). */
class EpochScopeRevocationTest {

    @Test fun enqueueRejectsStaleAndFutureEpochs() {
        val o2 = FamilyOutbox.empty(A1, E2)
        assertEquals(Refusal.STALE_EPOCH, o2.enqueue(op(1), A1, E1, add(item(1), "Milk")).refusal())
        val o1 = FamilyOutbox.empty(A1, E1)
        assertEquals(Refusal.FUTURE_EPOCH, o1.enqueue(op(1), A1, E2, add(item(1), "Milk")).refusal())
    }

    @Test fun epochAdvanceQuarantinesOldOperationsWithoutRetagging() {
        var o = FamilyOutbox.empty(A1, E1)
            .q(op(1), add(item(1), "Milk"))
            .q(op(2), add(item(2), "Eggs"))
        o = o.dispatchNext().sent().first.recordAmbiguous(A1, op(1)).applied() // op 1 is RETRY_WAIT
        o = o.advanceEpoch(E2).applied()
        assertEquals(OpState.QUARANTINED_STALE_EPOCH, o.state(op(1)))
        assertEquals(OpState.QUARANTINED_STALE_EPOCH, o.state(op(2)))
        // Never re-tagged: the captured epoch is still E1.
        assertTrue(o.operations.all { it.epoch == E1 })
        // Negative: nothing from the old epoch is dispatched or replayed.
        o.dispatchNext().idle(IdleReason.EMPTY)
        // New-epoch work proceeds normally.
        val (_, next) = o.q(op(3), add(item(3), "Rice")).dispatchNext().sent()
        assertEquals(op(3), next.opId)
        assertEquals(E2, next.epoch)
    }

    @Test fun inFlightOldEpochWaitsForOutcomeAndAmbiguityQuarantines() {
        var o = FamilyOutbox.empty(A1, E1).q(op(1), add(item(1), "Milk")).dispatchNext().sent().first
        o = o.advanceEpoch(E2).applied()
        assertEquals(OpState.IN_FLIGHT, o.state(op(1))) // the authoritative answer may still arrive
        // An authoritative commit is still accepted (A2-D1: a committed replay is valid after epoch advance).
        assertEquals(OpState.COMMITTED, o.recordCommitted(A1, op(1), 1, AddOutcome.CREATED).applied().state(op(1)))
        // Ambiguity under a stale epoch fails closed: quarantine, no replay (open question Q-1).
        assertEquals(OpState.QUARANTINED_STALE_EPOCH, o.recordAmbiguous(A1, op(1)).applied().state(op(1)))
    }

    @Test fun newEpochDependentOnQuarantinedAddIsBlocked() {
        val id = item(1)
        var o = FamilyOutbox.empty(A1, E1).q(op(1), add(id, "Milk")).advanceEpoch(E2).applied()
        o = o.q(op(2), edit(id, "Oat milk"))
        assertEquals(OpState.BLOCKED_DEPENDENCY, o.state(op(2)))
        o.dispatchNext().idle(IdleReason.EMPTY)
    }

    @Test fun epochNeverMovesBackwards() {
        val o = FamilyOutbox.empty(A1, E2)
        assertEquals(Refusal.STALE_EPOCH, o.advanceEpoch(E1).refusal())
        assertTrue(o.advanceEpoch(E2) is Transition.Unchanged)
    }

    @Test fun restoreQuarantinesStaleInFlight() {
        val o = FamilyOutbox.empty(A1, E1).q(op(1), add(item(1), "Milk")).dispatchNext().sent().first
        val restored = (FamilyOutbox.restore(A1, E2, ScopeAccess.ACTIVE, o.operations) as FamilyOutboxRestore.Restored).outbox
        assertEquals(OpState.QUARANTINED_STALE_EPOCH, restored.state(op(1)))
        // Negative: an operation whose epoch is newer than the scope is corrupt.
        assertEquals(FamilyOutboxRestore.Corrupt, FamilyOutbox.restore(A1, E1, ScopeAccess.ACTIVE, listOf(o.operations.single().copy(epoch = E2))))
    }

    // ---- PL-PP-WP02-11 (D1 portion only; no purge or database claimed) -----------------

    @Test fun revocationFailsClosedAndRetainsOperations() {
        var o = FamilyOutbox.empty(A1, E1).q(op(1), add(item(1), "Milk")).q(op(2), add(item(2), "Eggs"))
        o = o.dispatchNext().sent().first.revoke().applied()
        assertEquals(ScopeAccess.REVOKED, o.access)
        o.dispatchNext().idle(IdleReason.SCOPE_REVOKED)
        assertEquals(Refusal.SCOPE_REVOKED, o.enqueue(op(3), A1, E1, add(item(3), "Rice")).refusal())
        // Operations are retained untouched; purge is a deferred storage decision (D-5/D-7).
        assertEquals(2, o.operations.size)
        assertEquals(OpState.PENDING, o.state(op(2)))
        // A server outcome for the already in-flight op can still be recorded (it is a fact), but nothing new is sent.
        o = o.recordRejected(A1, op(1), ServerErrorCode("MEMBERSHIP_REVOKED")).applied()
        o.dispatchNext().idle(IdleReason.SCOPE_REVOKED)
        assertTrue(o.revoke() is Transition.Unchanged)
        val snapshot = ServerSnapshot(A1, E1, emptyList())
        assertEquals(ProjectionResult.Refused(ProjectionRefusal.SCOPE_REVOKED), ListProjector.project(snapshot, o))
    }
}
