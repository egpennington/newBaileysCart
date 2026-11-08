package com.penningtonlabs.baileyscart.core.model.offline

/**
 * Item commands mirror the ratified API v0.4 envelopes (`items.add`, `items.edit`,
 * `items.delete`, `items.undoDelete`). `familyId` and `familyEpoch` come from the owning
 * outbox and operation, so they cannot diverge from the command.
 */
sealed interface ItemCommand {
    val itemId: ItemId

    /** `items.add {itemId, name, category}`. */
    data class Add(override val itemId: ItemId, val name: ItemName, val category: Category) : ItemCommand

    /**
     * `items.edit {itemId, patch}`. At least one field must be present (checked on enqueue).
     * If both are present the server applies both; field-level merging is not implied.
     */
    data class Edit(override val itemId: ItemId, val name: ItemName?, val category: Category?) : ItemCommand

    /** `items.delete {itemId}`. */
    data class Delete(override val itemId: ItemId) : ItemCommand

    /** `items.undoDelete {deleteOpId}`. It always references the delete operation it reverses. */
    data class UndoDelete(override val itemId: ItemId, val deleteOpId: OpId) : ItemCommand
}

/** The last locally known content of an item, captured when a delete is created so Undo can render it. */
data class ItemImage(val itemId: ItemId, val name: String, val category: Category)
