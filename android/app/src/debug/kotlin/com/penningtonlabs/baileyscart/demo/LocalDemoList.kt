package com.penningtonlabs.baileyscart.demo

/*
 * BC-UI-S1 LOCAL DEMO shopping-list state. Debug source set only.
 *
 * Pure Kotlin, in memory, with no disk or network access. State is lost when the process
 * ends, which is expected demo behavior. This is not the WP-03 item model, and its Undo is
 * not the server items.undoDelete.
 */

/** The six categories, in their fixed display order. */
enum class DemoCategory { PRODUCE, DAIRY, DRY, FROZEN, MISC, MEAT }

data class DemoItem(val id: Long, val name: String, val category: DemoCategory)

/**
 * The single latest-only Undo slot. [generation] identifies the slot, so a timer or Undo
 * started for an older slot cannot affect a newer one. [expiresAtElapsedMs] is on the
 * monotonic elapsed-time clock (SystemClock.elapsedRealtime), not wall time.
 */
data class UndoSlot(val generation: Long, val item: DemoItem, val expiresAtElapsedMs: Long)

/** The last user-visible outcome. The UI shows it in a polite live region. */
sealed interface DemoEvent {
    val item: DemoItem
    data class Added(override val item: DemoItem) : DemoEvent
    data class Updated(override val item: DemoItem) : DemoEvent
    data class Deleted(override val item: DemoItem) : DemoEvent
    data class Restored(override val item: DemoItem) : DemoEvent
}

data class DemoListState(
    val items: List<DemoItem>,
    val nextId: Long,
    val undo: UndoSlot?,
    val nextGeneration: Long,
    val lastEvent: DemoEvent?,
) {
    /** Items in [category], sorted case-insensitively; ties broken by exact name, then id. */
    fun itemsIn(category: DemoCategory): List<DemoItem> =
        items.filter { it.category == category }.sortedWith(ITEM_ORDER)

    companion object {
        val ITEM_ORDER: Comparator<DemoItem> =
            compareBy<DemoItem, String>(String.CASE_INSENSITIVE_ORDER) { it.name }
                .thenBy { it.name }
                .thenBy { it.id }
    }
}

sealed interface DemoAction {
    data class Add(val rawName: String, val category: DemoCategory) : DemoAction
    data class Edit(val id: Long, val rawName: String, val category: DemoCategory) : DemoAction
    data class Delete(val id: Long, val nowElapsedMs: Long, val timeoutMs: Long) : DemoAction
    data class Undo(val generation: Long, val nowElapsedMs: Long) : DemoAction
    data class Expire(val generation: Long, val nowElapsedMs: Long) : DemoAction
}

sealed interface NameCheck {
    data class Valid(val name: String) : NameCheck
    data object Blank : NameCheck
    data object TooLong : NameCheck
}

object LocalDemoList {
    /** Default Undo window before any accessibility timeout extension. */
    const val UNDO_TIMEOUT_MS: Long = 5_000L

    /**
     * Display-name limit from API v0.4 (100 code points). The normative whitespace
     * normalization and canonical NameKey algorithm is OPEN (W-03), so this demo only trims
     * the ends and does not canonicalize or deduplicate names.
     */
    const val MAX_NAME_CODE_POINTS: Int = 100

    fun validateName(raw: String): NameCheck {
        val trimmed = raw.trim()
        return when {
            trimmed.isEmpty() -> NameCheck.Blank
            trimmed.codePointCount(0, trimmed.length) > MAX_NAME_CODE_POINTS -> NameCheck.TooLong
            else -> NameCheck.Valid(trimmed)
        }
    }

    /** Small, clearly fictional seed. MISC and MEAT start empty to show "No items yet." */
    fun initialState(): DemoListState {
        val seed = listOf(
            "Bananas" to DemoCategory.PRODUCE,
            "apples" to DemoCategory.PRODUCE,
            "Oat milk" to DemoCategory.DAIRY,
            "Rice" to DemoCategory.DRY,
            "Frozen peas" to DemoCategory.FROZEN,
        ).mapIndexed { i, (name, category) -> DemoItem(id = i + 1L, name = name, category = category) }
        return DemoListState(items = seed, nextId = seed.size + 1L, undo = null, nextGeneration = 1L, lastEvent = null)
    }

    fun reduce(state: DemoListState, action: DemoAction): DemoListState = when (action) {
        is DemoAction.Add -> add(state, action)
        is DemoAction.Edit -> edit(state, action)
        is DemoAction.Delete -> delete(state, action)
        is DemoAction.Undo -> undo(state, action)
        is DemoAction.Expire -> expire(state, action)
    }

    private fun add(state: DemoListState, a: DemoAction.Add): DemoListState {
        val name = (validateName(a.rawName) as? NameCheck.Valid)?.name ?: return state
        val item = DemoItem(id = state.nextId, name = name, category = a.category)
        return state.copy(items = state.items + item, nextId = state.nextId + 1, lastEvent = DemoEvent.Added(item))
    }

    private fun edit(state: DemoListState, a: DemoAction.Edit): DemoListState {
        val name = (validateName(a.rawName) as? NameCheck.Valid)?.name ?: return state
        val current = state.items.firstOrNull { it.id == a.id } ?: return state
        val updated = current.copy(name = name, category = a.category)
        if (updated == current) return state
        return state.copy(
            items = state.items.map { if (it.id == a.id) updated else it },
            lastEvent = DemoEvent.Updated(updated),
        )
    }

    /** Deleting replaces any earlier Undo slot. The earlier deletion becomes final. */
    private fun delete(state: DemoListState, a: DemoAction.Delete): DemoListState {
        val item = state.items.firstOrNull { it.id == a.id } ?: return state
        val slot = UndoSlot(
            generation = state.nextGeneration,
            item = item,
            expiresAtElapsedMs = a.nowElapsedMs + a.timeoutMs.coerceAtLeast(0L),
        )
        return state.copy(
            items = state.items.filterNot { it.id == a.id },
            undo = slot,
            nextGeneration = state.nextGeneration + 1,
            lastEvent = DemoEvent.Deleted(item),
        )
    }

    /**
     * Restores the exact deleted item only if [DemoAction.Undo.generation] names the current
     * slot and the window is still open (now < expiry). Otherwise the list is unchanged.
     */
    private fun undo(state: DemoListState, a: DemoAction.Undo): DemoListState {
        val slot = state.undo ?: return state
        if (slot.generation != a.generation) return state
        if (a.nowElapsedMs >= slot.expiresAtElapsedMs) return state.copy(undo = null)
        val alreadyPresent = state.items.any { it.id == slot.item.id }
        return state.copy(
            items = if (alreadyPresent) state.items else state.items + slot.item,
            undo = null,
            lastEvent = DemoEvent.Restored(slot.item),
        )
    }

    /** Clears the slot only if it is still the current slot and its window has closed. */
    private fun expire(state: DemoListState, a: DemoAction.Expire): DemoListState {
        val slot = state.undo ?: return state
        if (slot.generation != a.generation || a.nowElapsedMs < slot.expiresAtElapsedMs) return state
        return state.copy(undo = null)
    }
}
