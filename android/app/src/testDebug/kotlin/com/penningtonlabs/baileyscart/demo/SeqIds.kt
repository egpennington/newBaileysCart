package com.penningtonlabs.baileyscart.demo

import com.penningtonlabs.baileyscart.core.model.offline.ItemId
import com.penningtonlabs.baileyscart.core.model.offline.OpId

/**
 * Deterministic, strictly increasing UUID v4 identities for tests. Item and operation ids use
 * different variant nibbles (8 and a) so they never collide with each other or with the seed
 * ids (prefix 5eed0000).
 */
class SeqIds : DemoIds {
    private var nextItem = 1L
    private var nextOp = 1L

    override fun newItemId(): ItemId = ItemId.parse("00000000-0000-4000-8000-%012x".format(nextItem++))!!
    override fun newOpId(): OpId = OpId.parse("00000000-0000-4000-a000-%012x".format(nextOp++))!!
}

/** Always returns the same ItemId, to provoke the domain's duplicate-add refusal. */
class FixedItemIds(private val itemId: ItemId) : DemoIds {
    private val ops = SeqIds()
    override fun newItemId(): ItemId = itemId
    override fun newOpId(): OpId = ops.newOpId()
}
