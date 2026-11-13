package com.penningtonlabs.baileyscart.demo

import com.penningtonlabs.baileyscart.core.model.offline.AccountKey
import com.penningtonlabs.baileyscart.core.model.offline.Category
import com.penningtonlabs.baileyscart.core.model.offline.FamilyEpoch
import com.penningtonlabs.baileyscart.core.model.offline.FamilyId
import com.penningtonlabs.baileyscart.core.model.offline.FamilyKey
import com.penningtonlabs.baileyscart.core.model.offline.FamilyOutbox
import com.penningtonlabs.baileyscart.core.model.offline.ItemCommand
import com.penningtonlabs.baileyscart.core.model.offline.ItemId
import com.penningtonlabs.baileyscart.core.model.offline.ItemImage
import com.penningtonlabs.baileyscart.core.model.offline.ItemName
import com.penningtonlabs.baileyscart.core.model.offline.ListProjector
import com.penningtonlabs.baileyscart.core.model.offline.NameProblem
import com.penningtonlabs.baileyscart.core.model.offline.NameValidation
import com.penningtonlabs.baileyscart.core.model.offline.OpId
import com.penningtonlabs.baileyscart.core.model.offline.ProjectionResult
import com.penningtonlabs.baileyscart.core.model.offline.ServerSnapshot
import com.penningtonlabs.baileyscart.core.model.offline.Transition

/*
 * BC-UI-S2-WIRE LOCAL DEMO shopping-list state. Debug source set only.
 *
 * The visible list is driven by the BC-UI-S2a offline domain core: every Add, Edit, Delete and
 * Undo is enqueued on an in-memory FamilyOutbox, and the list shown is ListProjector's
 * projection. Nothing is dispatched, persisted or sent: there is no transport, so every
 * operation stays PENDING (or COALESCED_NO_OP) for the life of the process. State is lost when
 * the process ends, which is expected demo behavior. The Undo window (5 s, monotonic clock,
 * latest-only slot) is local UI policy; Undo itself is an items.undoDelete command that
 * references its delete operation.
 */

/** The six categories, in their fixed display order. The S2a domain enum is the single source. */
typealias DemoCategory = Category

data class DemoItem(val id: ItemId, val name: String, val category: DemoCategory)

/**
 * The single latest-only Undo slot. [generation] identifies the slot, so a timer or Undo
 * started for an older slot cannot affect a newer one. [deleteOpId] is the outbox operation the
 * Undo will reference. [expiresAtElapsedMs] is on the monotonic elapsed-time clock
 * (SystemClock.elapsedRealtime), not wall time.
 */
data class UndoSlot(val generation: Long, val item: DemoItem, val deleteOpId: OpId, val expiresAtElapsedMs: Long)

/** The last user-visible outcome. The UI shows it in a polite live region. */
sealed interface DemoEvent {
    val item: DemoItem
    data class Added(override val item: DemoItem) : DemoEvent
    data class Updated(override val item: DemoItem) : DemoEvent
    data class Deleted(override val item: DemoItem) : DemoEvent
    data class Restored(override val item: DemoItem) : DemoEvent
}

/**
 * [items] is always the current projection of [outbox] in S2a domain order (category, then
 * case-insensitive name, then exact name, then ItemId). It is never edited directly.
 */
data class DemoListState(
    val outbox: FamilyOutbox,
    val items: List<DemoItem>,
    val undo: UndoSlot?,
    val nextGeneration: Long,
    val lastEvent: DemoEvent?,
) {
    /** Items in [category], in projection order. */
    fun itemsIn(category: DemoCategory): List<DemoItem> = items.filter { it.category == category }
}

sealed interface DemoAction {
    data class Add(val rawName: String, val category: DemoCategory) : DemoAction
    data class Edit(val id: ItemId, val rawName: String, val category: DemoCategory) : DemoAction
    data class Delete(val id: ItemId, val nowElapsedMs: Long, val timeoutMs: Long) : DemoAction
    data class Undo(val generation: Long, val nowElapsedMs: Long) : DemoAction
    data class Expire(val generation: Long, val nowElapsedMs: Long) : DemoAction
}

sealed interface NameCheck {
    data class Valid(val name: String) : NameCheck
    data object Blank : NameCheck
    data object TooLong : NameCheck

    /** Line breaks, control or bidi characters, or unpaired surrogates (S2a ItemName rules). */
    data object NotAllowed : NameCheck
}

/** Source of new client identities. Injected so tests are deterministic. */
interface DemoIds {
    fun newItemId(): ItemId
    fun newOpId(): OpId
}

object RandomDemoIds : DemoIds {
    override fun newItemId(): ItemId = ItemId.random()
    override fun newOpId(): OpId = OpId.random()
}

object LocalDemoList {
    /** Default Undo window before any accessibility timeout extension. */
    const val UNDO_TIMEOUT_MS: Long = 5_000L

    /**
     * Fixed, fictional demo scope. These are not account or family identifiers from any real
     * system and grant nothing; they only partition the in-memory outbox.
     */
    val DEMO_KEY: FamilyKey = FamilyKey(
        account = checkNotNull(AccountKey.of("local-demo-account")),
        family = checkNotNull(FamilyId.of("local-demo-family")),
    )
    private val DEMO_EPOCH: FamilyEpoch = FamilyEpoch.INITIAL

    /**
     * ListProjector needs a baseline snapshot. This one is EMPTY: the demo has no server and
     * claims no server state. Every visible item comes from a local pending operation.
     */
    private val NO_SERVER_STATE: ServerSnapshot = ServerSnapshot(DEMO_KEY, DEMO_EPOCH, emptyList())

    /** Small, clearly fictional seed, enqueued as pending Adds with fixed ids. MISC and MEAT start empty. */
    private val SEED: List<Pair<String, DemoCategory>> = listOf(
        "Bananas" to Category.PRODUCE,
        "apples" to Category.PRODUCE,
        "Oat milk" to Category.DAIRY,
        "Rice" to Category.DRY,
        "Frozen peas" to Category.FROZEN,
    )

    /** S2a ItemName validation, mapped to the three messages the UI can show. */
    fun validateName(raw: String): NameCheck = when (val v = ItemName.validate(raw)) {
        is NameValidation.Valid -> NameCheck.Valid(v.name.display)
        is NameValidation.Invalid -> when (v.problem) {
            NameProblem.BLANK -> NameCheck.Blank
            NameProblem.TOO_LONG -> NameCheck.TooLong
            NameProblem.LINE_BREAK, NameProblem.CONTROL_CHARACTER, NameProblem.BIDI_CONTROL,
            NameProblem.UNPAIRED_SURROGATE -> NameCheck.NotAllowed
        }
    }

    /** An empty list over an empty outbox (no seed). */
    fun emptyState(): DemoListState =
        DemoListState(outbox = FamilyOutbox.empty(DEMO_KEY, DEMO_EPOCH), items = emptyList(), undo = null, nextGeneration = 1L, lastEvent = null)

    fun initialState(): DemoListState {
        var outbox = FamilyOutbox.empty(DEMO_KEY, DEMO_EPOCH)
        SEED.forEachIndexed { i, (name, category) ->
            val n = "%012x".format(i + 1)
            val itemId = checkNotNull(ItemId.parse("5eed0000-0000-4000-8000-$n"))
            val opId = checkNotNull(OpId.parse("5eed0000-0000-4000-9000-$n"))
            val itemName = (ItemName.validate(name) as NameValidation.Valid).name
            val t = outbox.enqueue(opId, DEMO_KEY, outbox.currentEpoch, ItemCommand.Add(itemId, itemName, category))
            outbox = (t as? Transition.Applied)?.outbox ?: error("seed enqueue refused: $t")
        }
        val items = project(outbox) ?: error("seed projection refused")
        return DemoListState(outbox = outbox, items = items, undo = null, nextGeneration = 1L, lastEvent = null)
    }

    fun reduce(state: DemoListState, action: DemoAction, ids: DemoIds = RandomDemoIds): DemoListState = when (action) {
        is DemoAction.Add -> add(state, action, ids)
        is DemoAction.Edit -> edit(state, action, ids)
        is DemoAction.Delete -> delete(state, action, ids)
        is DemoAction.Undo -> undo(state, action, ids)
        is DemoAction.Expire -> expire(state, action)
    }

    // ---- domain plumbing -------------------------------------------------------------------

    private fun project(outbox: FamilyOutbox): List<DemoItem>? =
        when (val r = ListProjector.project(NO_SERVER_STATE, outbox)) {
            is ProjectionResult.Projected -> r.projection.items.map { DemoItem(it.itemId, it.name, it.category) }
            is ProjectionResult.Refused -> null
        }

    /**
     * Enqueue [command] and re-project. Returns null (fail closed: the caller keeps the previous
     * state unchanged) on a refusal, an idempotent no-change, or a refused projection.
     */
    private fun apply(
        state: DemoListState,
        ids: DemoIds,
        command: ItemCommand,
        preImage: ItemImage? = null,
    ): Pair<FamilyOutbox, List<DemoItem>>? {
        val outbox = state.outbox
        val t = outbox.enqueue(ids.newOpId(), outbox.key, outbox.currentEpoch, command, preImage)
        val next = (t as? Transition.Applied)?.outbox ?: return null
        val items = project(next) ?: return null
        return next to items
    }

    private fun validName(raw: String): ItemName? = (ItemName.validate(raw) as? NameValidation.Valid)?.name

    // ---- actions ---------------------------------------------------------------------------

    private fun add(state: DemoListState, a: DemoAction.Add, ids: DemoIds): DemoListState {
        val name = validName(a.rawName) ?: return state
        val itemId = ids.newItemId()
        val (outbox, items) = apply(state, ids, ItemCommand.Add(itemId, name, a.category)) ?: return state
        val added = items.firstOrNull { it.id == itemId } ?: return state
        return state.copy(outbox = outbox, items = items, lastEvent = DemoEvent.Added(added))
    }

    /** Sends only the fields that changed. An edit that changes nothing enqueues nothing. */
    private fun edit(state: DemoListState, a: DemoAction.Edit, ids: DemoIds): DemoListState {
        val name = validName(a.rawName) ?: return state
        val current = state.items.firstOrNull { it.id == a.id } ?: return state
        val nameChange = name.takeIf { it.display != current.name }
        val categoryChange = a.category.takeIf { it != current.category }
        if (nameChange == null && categoryChange == null) return state
        val (outbox, items) = apply(state, ids, ItemCommand.Edit(a.id, nameChange, categoryChange)) ?: return state
        val updated = items.firstOrNull { it.id == a.id } ?: return state
        return state.copy(outbox = outbox, items = items, lastEvent = DemoEvent.Updated(updated))
    }

    /** Deleting replaces any earlier Undo slot. The earlier deletion becomes final. */
    private fun delete(state: DemoListState, a: DemoAction.Delete, ids: DemoIds): DemoListState {
        val item = state.items.firstOrNull { it.id == a.id } ?: return state
        val deleteOpId = ids.newOpId()
        val preImage = ItemImage(item.id, item.name, item.category)
        val t = state.outbox.enqueue(deleteOpId, state.outbox.key, state.outbox.currentEpoch, ItemCommand.Delete(item.id), preImage)
        val outbox = (t as? Transition.Applied)?.outbox ?: return state
        val items = project(outbox) ?: return state
        val slot = UndoSlot(
            generation = state.nextGeneration,
            item = item,
            deleteOpId = deleteOpId,
            expiresAtElapsedMs = a.nowElapsedMs + a.timeoutMs.coerceAtLeast(0L),
        )
        return state.copy(
            outbox = outbox,
            items = items,
            undo = slot,
            nextGeneration = state.nextGeneration + 1,
            lastEvent = DemoEvent.Deleted(item),
        )
    }

    /**
     * Enqueues items.undoDelete for the slot's delete only if [DemoAction.Undo.generation] names
     * the current slot and the window is still open (now < expiry). Otherwise nothing is
     * enqueued. A domain refusal leaves the state unchanged (fail closed).
     */
    private fun undo(state: DemoListState, a: DemoAction.Undo, ids: DemoIds): DemoListState {
        val slot = state.undo ?: return state
        if (slot.generation != a.generation) return state
        if (a.nowElapsedMs >= slot.expiresAtElapsedMs) return state.copy(undo = null)
        val (outbox, items) = apply(state, ids, ItemCommand.UndoDelete(slot.item.id, slot.deleteOpId)) ?: return state
        val restored = items.firstOrNull { it.id == slot.item.id } ?: return state
        return state.copy(outbox = outbox, items = items, undo = null, lastEvent = DemoEvent.Restored(restored))
    }

    /** Clears the slot only if it is still the current slot and its window has closed. Enqueues nothing. */
    private fun expire(state: DemoListState, a: DemoAction.Expire): DemoListState {
        val slot = state.undo ?: return state
        if (slot.generation != a.generation || a.nowElapsedMs < slot.expiresAtElapsedMs) return state
        return state.copy(undo = null)
    }
}
