package com.penningtonlabs.baileyscart.core.model.offline

/**
 * One active item from an authoritative server snapshot. `nameKeyId` and `canonVersion` are
 * carried opaquely from the server; the client never computes them (W-03 is OPEN).
 */
data class ServerItem(
    val itemId: ItemId,
    val name: String,
    val category: Category,
    val version: Long,
    val nameKeyId: String? = null,
    val canonVersion: Int? = null,
)

/** Authoritative server snapshot for exactly one family scope and epoch. Active items only; tombstones are excluded. */
data class ServerSnapshot(val key: FamilyKey, val epoch: FamilyEpoch, val items: List<ServerItem>)

enum class SyncMark { SYNCED, PENDING }

data class ProjectedItem(val itemId: ItemId, val name: String, val category: Category, val sync: SyncMark)

data class Projection(val items: List<ProjectedItem>, val attention: List<OutboxOperation>)

enum class ProjectionRefusal { SCOPE_MISMATCH, STALE_SNAPSHOT, FUTURE_SNAPSHOT, SCOPE_REVOKED, DUPLICATE_ITEM_ID }

sealed interface ProjectionResult {
    data class Projected(val projection: Projection) : ProjectionResult
    data class Refused(val reason: ProjectionRefusal) : ProjectionResult
}

/**
 * Render = authoritative snapshot + pending overlays, deterministic and side-effect free.
 *
 * Rules:
 *  - The snapshot is never modified. Only an authoritative acknowledgment (COMMITTED with a server
 *    version) can retire an overlay, and then only once the snapshot shows that version or later.
 *    Look-alike snapshot content proves nothing.
 *  - Overlays apply in sequence order. A pending delete hides the item, and a later edit cannot
 *    resurrect it (delete precedence).
 *  - Rejected, blocked and quarantined operations never render as committed. They are reported
 *    in [Projection.attention].
 *  - A snapshot for another scope or epoch is refused.
 */
object ListProjector {
    private val ORDER: Comparator<ProjectedItem> =
        compareBy<ProjectedItem> { it.category.ordinal }
            .thenBy(String.CASE_INSENSITIVE_ORDER) { it.name }
            .thenBy { it.name }
            .thenBy { it.itemId.value }

    fun project(snapshot: ServerSnapshot, outbox: FamilyOutbox): ProjectionResult {
        if (outbox.access == ScopeAccess.REVOKED) return ProjectionResult.Refused(ProjectionRefusal.SCOPE_REVOKED)
        if (snapshot.key != outbox.key) return ProjectionResult.Refused(ProjectionRefusal.SCOPE_MISMATCH)
        if (snapshot.epoch < outbox.currentEpoch) return ProjectionResult.Refused(ProjectionRefusal.STALE_SNAPSHOT)
        if (snapshot.epoch > outbox.currentEpoch) return ProjectionResult.Refused(ProjectionRefusal.FUTURE_SNAPSHOT)
        if (snapshot.items.map { it.itemId }.toSet().size != snapshot.items.size) {
            return ProjectionResult.Refused(ProjectionRefusal.DUPLICATE_ITEM_ID)
        }

        val server = snapshot.items.associateBy { it.itemId }
        val view = LinkedHashMap<ItemId, ProjectedItem>()
        snapshot.items.forEach { view[it.itemId] = ProjectedItem(it.itemId, it.name, it.category, SyncMark.SYNCED) }

        for (op in outbox.operations.sortedBy { it.sequence }) {
            val mark = when {
                op.state.isActive -> SyncMark.PENDING
                op.state == OpState.COMMITTED && !snapshotReflects(server, op) -> SyncMark.SYNCED
                else -> null // retired, coalesced, failed or parked: no overlay
            } ?: continue
            applyOverlay(view, op, mark, outbox)
        }
        return ProjectionResult.Projected(Projection(view.values.sortedWith(ORDER), outbox.attention))
    }

    /** True if the authoritative snapshot already reflects the committed [op] (version evidence only). */
    private fun snapshotReflects(server: Map<ItemId, ServerItem>, op: OutboxOperation): Boolean {
        val version = op.committedVersion ?: return true
        val item = server[op.command.itemId]
        return when (op.command) {
            // A satisfied-by-existing add created nothing under our ItemId, so there is never an overlay.
            is ItemCommand.Add -> op.addOutcome == AddOutcome.SATISFIED_BY_EXISTING_ITEM || (item != null && item.version >= version)
            is ItemCommand.Edit, is ItemCommand.UndoDelete -> item != null && item.version >= version
            // Committed delete: reflected once the item is gone from the active snapshot or has moved past that version.
            is ItemCommand.Delete -> item == null || item.version >= version
        }
    }

    private fun applyOverlay(view: MutableMap<ItemId, ProjectedItem>, op: OutboxOperation, mark: SyncMark, outbox: FamilyOutbox) {
        when (val c = op.command) {
            is ItemCommand.Add -> if (op.addOutcome != AddOutcome.SATISFIED_BY_EXISTING_ITEM) {
                view[c.itemId] = ProjectedItem(c.itemId, c.name.display, c.category, mark)
            }
            is ItemCommand.Edit -> view[c.itemId]?.let { cur ->
                view[c.itemId] = cur.copy(
                    name = c.name?.display ?: cur.name,
                    category = c.category ?: cur.category,
                    sync = if (mark == SyncMark.PENDING) SyncMark.PENDING else cur.sync,
                )
            }
            is ItemCommand.Delete -> view.remove(c.itemId)
            is ItemCommand.UndoDelete -> {
                val image = outbox.operation(c.deleteOpId)?.preImage
                val existing = view[c.itemId]
                when {
                    existing != null -> view[c.itemId] = existing.copy(sync = if (mark == SyncMark.PENDING) SyncMark.PENDING else existing.sync)
                    image != null -> view[c.itemId] = ProjectedItem(c.itemId, image.name, image.category, mark)
                    // No known content: render nothing rather than invent it.
                    else -> Unit
                }
            }
        }
    }
}
