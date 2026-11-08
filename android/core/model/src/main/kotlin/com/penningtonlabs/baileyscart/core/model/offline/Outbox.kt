package com.penningtonlabs.baileyscart.core.model.offline

/**
 * Operation states. The proposed contract (Feature spec WP-02 v0.2 §5) plus two CODI-named
 * fail-closed states, which are disclosed in the implementation report:
 *  - [QUARANTINED_STALE_EPOCH]: R-04 Architecture amendment §B says old-epoch operations are
 *    "quarantined, never mutated to new epoch".
 *  - [COALESCED_NO_OP]: Architecture v1.1 §5 records an unsent delete plus Undo pair as a local
 *    no-op.
 * [QUARANTINED_AGED] is modeled but policy-inactive (PL D-9: no cutoff). No transition produces it.
 */
enum class OpState {
    PENDING,
    IN_FLIGHT,
    COMMITTED,
    REJECTED_TERMINAL,
    RETRY_WAIT,
    BLOCKED_DEPENDENCY,
    QUARANTINED_AGED,
    QUARANTINED_STALE_EPOCH,
    COALESCED_NO_OP,
    ;

    /** May be (re)dispatched by [FamilyOutbox.dispatchNext]. */
    val isDispatchable: Boolean get() = this == PENDING || this == RETRY_WAIT

    /** Still represents user intent awaiting a server outcome. */
    val isActive: Boolean get() = this == PENDING || this == IN_FLIGHT || this == RETRY_WAIT

    /** Parked without success. Needs a future ratified recovery policy (D-9: fail closed). */
    val isFailedOrParked: Boolean
        get() = this == REJECTED_TERMINAL || this == BLOCKED_DEPENDENCY || this == QUARANTINED_AGED ||
            this == QUARANTINED_STALE_EPOCH
}

/** How the server satisfied an `items.add`. */
enum class AddOutcome {
    /** The item was created under the client's ItemId. */
    CREATED,

    /** API v0.4: "duplicate canonical add is satisfied without duplicate item, but dependents cannot retarget". */
    SATISFIED_BY_EXISTING_ITEM,
}

/** Stable API error code as received. No new API codes are defined here. */
@JvmInline
value class ServerErrorCode(val code: String)

data class OutboxOperation(
    val opId: OpId,
    val key: FamilyKey,
    /** Epoch captured at creation. Never changed afterwards. */
    val epoch: FamilyEpoch,
    val sequence: Long,
    val command: ItemCommand,
    val state: OpState,
    /** True once the operation has ever been handed to transport. It may then have reached the server. */
    val dispatched: Boolean = false,
    val attempts: Int = 0,
    /** The earlier operation this one causally depends on (add → edit/delete, delete → undo). */
    val dependsOn: OpId? = null,
    val committedVersion: Long? = null,
    val addOutcome: AddOutcome? = null,
    val rejection: ServerErrorCode? = null,
    /** Proposed local metadata (not an API field): pre-delete content for rendering Undo. */
    val preImage: ItemImage? = null,
) {
    /** The immutable request identity. A retry must reproduce exactly this. */
    val requestIdentity: RequestIdentity get() = RequestIdentity(opId, key, epoch, command)
}

data class RequestIdentity(val opId: OpId, val key: FamilyKey, val epoch: FamilyEpoch, val command: ItemCommand)

enum class ScopeAccess { ACTIVE, REVOKED }

/**
 * Typed refusal reasons. These are domain results, not new public API error codes. A blocked
 * dependency is an operation state ([OpState.BLOCKED_DEPENDENCY]), not a refusal, and a corrupt
 * saved state is [FamilyOutboxRestore.Corrupt].
 */
enum class Refusal {
    SCOPE_MISMATCH,
    STALE_EPOCH,
    FUTURE_EPOCH,
    INVALID_INPUT,
    CONFLICTING_TRANSITION,
    PAYLOAD_MISMATCH,
    UNKNOWN_OPERATION,
    SCOPE_REVOKED,
}

sealed interface Transition {
    /** State changed. */
    data class Applied(val outbox: FamilyOutbox) : Transition

    /** Idempotent repeat (same opId and payload, or a duplicate acknowledgment). Nothing changed. */
    data class Unchanged(val outbox: FamilyOutbox) : Transition

    /** Fail-closed refusal. The caller's outbox is unchanged. */
    data class Refused(val reason: Refusal) : Transition
}

enum class IdleReason { EMPTY, IN_FLIGHT_BUSY, SCOPE_REVOKED, AWAITING_DEPENDENCY }

sealed interface Dispatch {
    /** Send exactly [operation]. The outbox now records it as IN_FLIGHT. */
    data class Send(val outbox: FamilyOutbox, val operation: OutboxOperation) : Dispatch

    data class Idle(val outbox: FamilyOutbox, val reason: IdleReason) : Dispatch
}

/**
 * Immutable per-(account, family) FIFO outbox.
 *
 * Invariants:
 *  - Every operation's key equals [key]. Sequences strictly increase. OpIds are unique.
 *  - At most one operation is IN_FLIGHT.
 *  - Dispatch follows sequence order: the first dispatchable operation goes next, so a
 *    RETRY_WAIT head is retried before any later operation (no overtaking). Failed or parked
 *    operations are terminal for dispatch and are passed over only after their dependents have
 *    been reconciled to BLOCKED_DEPENDENCY.
 *  - Operations are never re-tagged to another epoch, key, opId or payload.
 *  - There is no wall clock and no aging (D-9).
 */
class FamilyOutbox private constructor(
    val key: FamilyKey,
    val currentEpoch: FamilyEpoch,
    val access: ScopeAccess,
    val operations: List<OutboxOperation>,
    private val nextSequence: Long,
) {
    fun operation(opId: OpId): OutboxOperation? = operations.firstOrNull { it.opId == opId }

    /** Operations needing future attention or UX (failed or parked), in order. */
    val attention: List<OutboxOperation> get() = operations.filter { it.state.isFailedOrParked }

    // ---- enqueue -----------------------------------------------------------------------

    /**
     * Enqueue a new logical command created under [epoch]. Replaying the same opId with an
     * identical request is idempotent; the same opId with any difference is refused.
     */
    fun enqueue(
        opId: OpId,
        key: FamilyKey,
        epoch: FamilyEpoch,
        command: ItemCommand,
        preImage: ItemImage? = null,
    ): Transition {
        if (key != this.key) return Transition.Refused(Refusal.SCOPE_MISMATCH)
        operation(opId)?.let { existing ->
            return if (existing.requestIdentity == RequestIdentity(opId, key, epoch, command)) {
                Transition.Unchanged(this)
            } else {
                Transition.Refused(Refusal.PAYLOAD_MISMATCH)
            }
        }
        if (access == ScopeAccess.REVOKED) return Transition.Refused(Refusal.SCOPE_REVOKED)
        if (epoch < currentEpoch) return Transition.Refused(Refusal.STALE_EPOCH)
        if (epoch > currentEpoch) return Transition.Refused(Refusal.FUTURE_EPOCH)

        val dependsOn: OpId?
        when (command) {
            is ItemCommand.Add -> {
                if (operations.any { it.command.itemId == command.itemId }) return Transition.Refused(Refusal.INVALID_INPUT)
                dependsOn = null
            }
            is ItemCommand.Edit -> {
                if (command.name == null && command.category == null) return Transition.Refused(Refusal.INVALID_INPUT)
                dependsOn = latestAddOf(command.itemId)?.opId
            }
            is ItemCommand.Delete -> dependsOn = latestAddOf(command.itemId)?.opId
            is ItemCommand.UndoDelete -> {
                val delete = operation(command.deleteOpId)
                if (delete == null || delete.command !is ItemCommand.Delete || delete.command.itemId != command.itemId) {
                    return Transition.Refused(Refusal.UNKNOWN_OPERATION)
                }
                if (canCoalesce(delete)) return Transition.Applied(coalesce(delete, opId, epoch, command))
                dependsOn = delete.opId
            }
        }
        val dependency = dependsOn?.let { operation(it) }
        val initial = if (dependency != null && dependencyFailed(dependency)) OpState.BLOCKED_DEPENDENCY else OpState.PENDING
        val op = OutboxOperation(
            opId = opId, key = key, epoch = epoch, sequence = nextSequence, command = command,
            state = initial, dependsOn = dependsOn, preImage = preImage,
        )
        return Transition.Applied(copy(operations = operations + op, nextSequence = nextSequence + 1))
    }

    // ---- dispatch ----------------------------------------------------------------------

    /** Select the next operation to send. At most one IN_FLIGHT; strict sequence order. */
    fun dispatchNext(): Dispatch {
        if (access == ScopeAccess.REVOKED) return Dispatch.Idle(this, IdleReason.SCOPE_REVOKED)
        if (operations.any { it.state == OpState.IN_FLIGHT }) return Dispatch.Idle(this, IdleReason.IN_FLIGHT_BUSY)
        val head = operations.firstOrNull { it.state.isDispatchable } ?: return Dispatch.Idle(this, IdleReason.EMPTY)
        if (head.epoch != currentEpoch) {
            // Defensive. advanceEpoch already quarantines these. Never dispatch under another epoch.
            return Dispatch.Idle(reconcile(replace(head.copy(state = OpState.QUARANTINED_STALE_EPOCH))), IdleReason.EMPTY)
        }
        val dependency = head.dependsOn?.let { operation(it) }
        if (dependency != null && !dependencySucceeded(dependency)) {
            if (dependencyFailed(dependency)) {
                return Dispatch.Idle(reconcile(replace(head.copy(state = OpState.BLOCKED_DEPENDENCY))), IdleReason.EMPTY)
            }
            return Dispatch.Idle(this, IdleReason.AWAITING_DEPENDENCY)
        }
        val sent = head.copy(state = OpState.IN_FLIGHT, dispatched = true, attempts = head.attempts + 1)
        return Dispatch.Send(replace(sent), sent)
    }

    // ---- server outcomes ---------------------------------------------------------------

    /** Authoritative success for the IN_FLIGHT [opId]. A duplicate identical acknowledgment is idempotent. */
    fun recordCommitted(key: FamilyKey, opId: OpId, serverVersion: Long, addOutcome: AddOutcome? = null): Transition {
        if (key != this.key) return Transition.Refused(Refusal.SCOPE_MISMATCH)
        val op = operation(opId) ?: return Transition.Refused(Refusal.UNKNOWN_OPERATION)
        val isAdd = op.command is ItemCommand.Add
        if (isAdd != (addOutcome != null) || serverVersion < 1) return Transition.Refused(Refusal.INVALID_INPUT)
        if (op.state == OpState.COMMITTED) {
            return if (op.committedVersion == serverVersion && op.addOutcome == addOutcome) {
                Transition.Unchanged(this)
            } else {
                Transition.Refused(Refusal.CONFLICTING_TRANSITION)
            }
        }
        if (op.state != OpState.IN_FLIGHT) return Transition.Refused(Refusal.CONFLICTING_TRANSITION)
        val done = op.copy(state = OpState.COMMITTED, committedVersion = serverVersion, addOutcome = addOutcome)
        return Transition.Applied(reconcile(replace(done)))
    }

    /** Definite terminal rejection for the IN_FLIGHT [opId]. Dependents become BLOCKED_DEPENDENCY. */
    fun recordRejected(key: FamilyKey, opId: OpId, code: ServerErrorCode): Transition {
        if (key != this.key) return Transition.Refused(Refusal.SCOPE_MISMATCH)
        val op = operation(opId) ?: return Transition.Refused(Refusal.UNKNOWN_OPERATION)
        if (op.state == OpState.REJECTED_TERMINAL) {
            return if (op.rejection == code) Transition.Unchanged(this) else Transition.Refused(Refusal.CONFLICTING_TRANSITION)
        }
        if (op.state != OpState.IN_FLIGHT) return Transition.Refused(Refusal.CONFLICTING_TRANSITION)
        return Transition.Applied(reconcile(replace(op.copy(state = OpState.REJECTED_TERMINAL, rejection = code))))
    }

    /**
     * Ambiguous transport failure. The operation may or may not have reached the server. It is
     * kept unchanged (same opId, epoch, item, command and payload) for retry. If its epoch is no
     * longer current it is quarantined instead (fail closed; see the report's open question on
     * A2-D1 replay).
     */
    fun recordAmbiguous(key: FamilyKey, opId: OpId): Transition {
        if (key != this.key) return Transition.Refused(Refusal.SCOPE_MISMATCH)
        val op = operation(opId) ?: return Transition.Refused(Refusal.UNKNOWN_OPERATION)
        if (op.state != OpState.IN_FLIGHT) return Transition.Refused(Refusal.CONFLICTING_TRANSITION)
        val next = if (op.epoch < currentEpoch) OpState.QUARANTINED_STALE_EPOCH else OpState.RETRY_WAIT
        return Transition.Applied(reconcile(replace(op.copy(state = next))))
    }

    // ---- scope events ------------------------------------------------------------------

    /**
     * The server-authorized family epoch advanced (a successful restore). Not-yet-sent and
     * awaiting-retry operations from older epochs are quarantined, never re-tagged. An IN_FLIGHT
     * operation keeps waiting for its authoritative response.
     */
    fun advanceEpoch(newEpoch: FamilyEpoch): Transition {
        if (newEpoch == currentEpoch) return Transition.Unchanged(this)
        if (newEpoch < currentEpoch) return Transition.Refused(Refusal.STALE_EPOCH)
        val updated = operations.map {
            if (it.state.isDispatchable && it.epoch < newEpoch) it.copy(state = OpState.QUARANTINED_STALE_EPOCH) else it
        }
        return Transition.Applied(reconcile(copy(currentEpoch = newEpoch, operations = updated)))
    }

    /**
     * Membership or access revoked (authoritative signal supplied by a future integration).
     * Fail closed: no dispatch, no enqueue, no projection. Operations are retained untouched.
     * Purging is a storage concern deferred to S2b (D-5/D-7).
     */
    fun revoke(): Transition =
        if (access == ScopeAccess.REVOKED) Transition.Unchanged(this) else Transition.Applied(copy(access = ScopeAccess.REVOKED))

    // ---- internals ---------------------------------------------------------------------

    private fun latestAddOf(itemId: ItemId): OutboxOperation? =
        operations.lastOrNull { it.command is ItemCommand.Add && it.command.itemId == itemId }

    private fun dependencySucceeded(dep: OutboxOperation): Boolean =
        dep.state == OpState.COMMITTED && dep.addOutcome != AddOutcome.SATISFIED_BY_EXISTING_ITEM

    private fun dependencyFailed(dep: OutboxOperation): Boolean =
        dep.state.isFailedOrParked || dep.state == OpState.COALESCED_NO_OP ||
            (dep.state == OpState.COMMITTED && dep.addOutcome == AddOutcome.SATISFIED_BY_EXISTING_ITEM)

    /** A delete may be coalesced only if it was never dispatched and nothing later targets its item. */
    private fun canCoalesce(delete: OutboxOperation): Boolean =
        delete.state == OpState.PENDING && !delete.dispatched &&
            operations.none { it.sequence > delete.sequence && it.command.itemId == delete.command.itemId }

    private fun coalesce(delete: OutboxOperation, undoOpId: OpId, epoch: FamilyEpoch, undo: ItemCommand): FamilyOutbox {
        val undoRecord = OutboxOperation(
            opId = undoOpId, key = key, epoch = epoch, sequence = nextSequence, command = undo,
            state = OpState.COALESCED_NO_OP, dependsOn = delete.opId,
        )
        return copy(operations = operations.map { if (it.opId == delete.opId) it.copy(state = OpState.COALESCED_NO_OP) else it } + undoRecord, nextSequence = nextSequence + 1)
    }

    /** Propagate dependency failure transitively until stable: dependents of failed or parked operations are blocked. */
    private fun reconcile(outbox: FamilyOutbox): FamilyOutbox {
        var ops = outbox.operations
        var changed = true
        while (changed) {
            changed = false
            val byId = ops.associateBy { it.opId }
            ops = ops.map { op ->
                val dep = op.dependsOn?.let { byId[it] }
                if (op.state.isDispatchable && dep != null && dependencyFailed(dep)) {
                    changed = true
                    op.copy(state = OpState.BLOCKED_DEPENDENCY)
                } else {
                    op
                }
            }
        }
        return outbox.copy(operations = ops)
    }

    private fun replace(op: OutboxOperation): FamilyOutbox = copy(operations = operations.map { if (it.opId == op.opId) op else it })

    private fun copy(
        currentEpoch: FamilyEpoch = this.currentEpoch,
        access: ScopeAccess = this.access,
        operations: List<OutboxOperation> = this.operations,
        nextSequence: Long = this.nextSequence,
    ) = FamilyOutbox(key, currentEpoch, access, operations, nextSequence)

    override fun equals(other: Any?): Boolean =
        other is FamilyOutbox && key == other.key && currentEpoch == other.currentEpoch && access == other.access &&
            operations == other.operations && nextSequence == other.nextSequence

    override fun hashCode(): Int = listOf(key, currentEpoch, access, operations, nextSequence).hashCode()

    override fun toString(): String = "FamilyOutbox(epoch=$currentEpoch, access=$access, ops=${operations.size})"

    companion object {
        fun empty(key: FamilyKey, epoch: FamilyEpoch): FamilyOutbox = FamilyOutbox(key, epoch, ScopeAccess.ACTIVE, emptyList(), 1)

        /**
         * Rebuild from a previously supplied state value (serialization-independent; there is no
         * durability claim). Validates the invariants. An operation recorded as IN_FLIGHT has an
         * unknown outcome after a restart, so it is restored as ambiguous: RETRY_WAIT, or
         * quarantined if stale.
         */
        fun restore(
            key: FamilyKey,
            currentEpoch: FamilyEpoch,
            access: ScopeAccess,
            operations: List<OutboxOperation>,
        ): FamilyOutboxRestore {
            val sorted = operations.sortedBy { it.sequence }
            val valid = sorted.all { it.key == key && it.epoch <= currentEpoch } &&
                sorted.map { it.opId }.toSet().size == sorted.size &&
                sorted.map { it.sequence }.toSet().size == sorted.size &&
                sorted.all { it.sequence >= 1 } &&
                sorted.count { it.state == OpState.IN_FLIGHT } <= 1
            if (!valid) return FamilyOutboxRestore.Corrupt
            val recovered = sorted.map {
                if (it.state == OpState.IN_FLIGHT) {
                    it.copy(state = if (it.epoch < currentEpoch) OpState.QUARANTINED_STALE_EPOCH else OpState.RETRY_WAIT)
                } else {
                    it
                }
            }
            val next = (sorted.maxOfOrNull { it.sequence } ?: 0) + 1
            val outbox = FamilyOutbox(key, currentEpoch, access, recovered, next)
            return FamilyOutboxRestore.Restored(outbox.reconcile(outbox))
        }
    }
}

sealed interface FamilyOutboxRestore {
    data class Restored(val outbox: FamilyOutbox) : FamilyOutboxRestore
    data object Corrupt : FamilyOutboxRestore
}
