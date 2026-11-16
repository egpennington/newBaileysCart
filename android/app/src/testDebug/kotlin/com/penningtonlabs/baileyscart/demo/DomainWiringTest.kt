package com.penningtonlabs.baileyscart.demo

import com.penningtonlabs.baileyscart.core.model.offline.Category
import com.penningtonlabs.baileyscart.core.model.offline.FamilyEpoch
import com.penningtonlabs.baileyscart.core.model.offline.ItemCommand
import com.penningtonlabs.baileyscart.core.model.offline.ItemId
import com.penningtonlabs.baileyscart.core.model.offline.ItemImage
import com.penningtonlabs.baileyscart.core.model.offline.OpId
import com.penningtonlabs.baileyscart.core.model.offline.OpState
import com.penningtonlabs.baileyscart.core.model.offline.OutboxOperation
import com.penningtonlabs.baileyscart.core.model.offline.Transition
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * BC-UI-S2-WIRE D1 (PL-PP-WP01-06): the LOCAL DEMO list is driven only by the S2a outbox and
 * projection, in memory, with nothing dispatched.
 */
class DomainWiringTest {
    private val r = LocalDemoList
    private val timeout = LocalDemoList.UNDO_TIMEOUT_MS
    private val ids = SeqIds()

    private fun DemoListState.act(a: DemoAction) = r.reduce(this, a, ids)
    private val DemoListState.ops: List<OutboxOperation> get() = outbox.operations

    /** Builds a string from code points so no invisible or unpaired characters sit in this source file. */
    private fun cps(vararg codePoints: Int): String = buildString { codePoints.forEach { appendCodePoint(it) } }
    private fun withChar(prefix: String, ch: Int, suffix: String = ""): String = prefix + cps(ch) + suffix

    /** Nothing is ever sent: no transport exists in this slice. */
    private fun assertNeverDispatched(s: DemoListState) {
        assertTrue(s.ops.none { it.dispatched || it.attempts != 0 })
        assertTrue(s.ops.none { it.state == OpState.IN_FLIGHT || it.state == OpState.COMMITTED })
    }

    @Test fun addEditDeleteUndoJourneyPreservesIdentityAndLinksTheUndoToItsDelete() {
        var s = r.emptyState()

        // Add
        s = s.act(DemoAction.Add(" Eggs ", Category.DAIRY))
        val item = s.items.single()
        val id = item.id
        assertEquals(DemoItem(id, "Eggs", Category.DAIRY), item)
        assertEquals(DemoEvent.Added(item), s.lastEvent)
        val add = s.ops.single()
        assertTrue(add.command is ItemCommand.Add)
        assertEquals(OpState.PENDING, add.state)
        assertEquals(LocalDemoList.DEMO_KEY, add.key)
        assertEquals(FamilyEpoch.INITIAL, add.epoch)

        // Edit (name and category both change)
        s = s.act(DemoAction.Edit(id, "Free-range eggs", Category.MISC))
        val edited = s.items.single()
        assertEquals(DemoItem(id, "Free-range eggs", Category.MISC), edited)
        assertEquals(DemoEvent.Updated(edited), s.lastEvent)
        assertEquals(add.opId, s.ops.last().dependsOn)

        // Delete
        s = s.act(DemoAction.Delete(id, nowElapsedMs = 1_000, timeoutMs = timeout))
        assertTrue(s.items.isEmpty())
        assertEquals(DemoEvent.Deleted(edited), s.lastEvent)
        val slot = s.undo!!
        val delete = s.ops.last()
        assertEquals(ItemCommand.Delete(id), delete.command)
        assertEquals(delete.opId, slot.deleteOpId)
        assertEquals(ItemImage(id, "Free-range eggs", Category.MISC), delete.preImage)
        assertEquals(OpState.PENDING, delete.state)

        // Undo inside the window
        s = s.act(DemoAction.Undo(slot.generation, nowElapsedMs = 5_999))
        assertEquals(listOf(edited), s.items)
        assertEquals(DemoEvent.Restored(edited), s.lastEvent)
        assertNull(s.undo)
        val undo = s.ops.last()
        assertEquals(ItemCommand.UndoDelete(id, slot.deleteOpId), undo.command)
        assertEquals(slot.deleteOpId, undo.dependsOn)
        // The unsent delete + Undo pair coalesces to a recorded local no-op; nothing is erased.
        assertEquals(OpState.COALESCED_NO_OP, s.outbox.operation(slot.deleteOpId)!!.state)
        assertEquals(OpState.COALESCED_NO_OP, undo.state)
        assertEquals(listOf(OpState.PENDING, OpState.PENDING), s.ops.take(2).map { it.state })
        assertEquals(4, s.ops.size)
        assertEquals(s.ops.map { it.sequence }.sorted(), s.ops.map { it.sequence })
        assertNeverDispatched(s)

        // The restored item stays fully usable under the same ItemId.
        s = s.act(DemoAction.Edit(id, "Eggs", Category.DAIRY))
        assertEquals(DemoItem(id, "Eggs", Category.DAIRY), s.items.single())
        assertEquals(add.opId, s.ops.last().dependsOn)
    }

    @Test fun seedIsFivePendingAddsAndNoServerState() {
        val s = r.initialState()
        assertEquals(5, s.ops.size)
        assertTrue(s.ops.all { it.command is ItemCommand.Add && it.state == OpState.PENDING })
        assertEquals(s.ops.map { it.command.itemId }.toSet(), s.items.map { it.id }.toSet())
        assertNeverDispatched(s)
        // Deterministic: two fresh seeds are identical.
        assertEquals(s, r.initialState())
    }

    @Test fun seedItemDeleteAndUndoCoalescesAndRestoresTheSameItem() {
        val s0 = r.initialState()
        val rice = s0.items.single { it.name == "Rice" }
        val s1 = s0.act(DemoAction.Delete(rice.id, 0, timeout))
        val s2 = s1.act(DemoAction.Undo(1, 1))
        assertEquals(s0.items, s2.items)
        assertEquals(OpState.COALESCED_NO_OP, s2.outbox.operation(s1.undo!!.deleteOpId)!!.state)
    }

    @Test fun editSendsOnlyChangedFieldsAndNoOpEditEnqueuesNothing() {
        var s = r.emptyState().act(DemoAction.Add("Kale", Category.PRODUCE))
        val id = s.items.single().id

        s = s.act(DemoAction.Edit(id, "Kale", Category.DRY))
        val categoryOnly = s.ops.last().command as ItemCommand.Edit
        assertNull(categoryOnly.name)
        assertEquals(Category.DRY, categoryOnly.category)

        s = s.act(DemoAction.Edit(id, " Curly kale ", Category.DRY))
        val nameOnly = s.ops.last().command as ItemCommand.Edit
        assertEquals("Curly kale", nameOnly.name!!.display)
        assertNull(nameOnly.category)

        val before = s.ops.size
        assertSame(s, s.act(DemoAction.Edit(id, "Curly kale", Category.DRY)))
        assertEquals(before, s.ops.size)
    }

    @Test fun expiredUndoEnqueuesNothingAndTheDeleteStands() {
        val s0 = r.emptyState().act(DemoAction.Add("Ham", Category.MEAT))
        val s1 = s0.act(DemoAction.Delete(s0.items.single().id, 0, timeout))
        val deleteOpId = s1.undo!!.deleteOpId

        val late = s1.act(DemoAction.Undo(1, nowElapsedMs = 5_000))
        assertEquals(s1.outbox, late.outbox)
        assertTrue(late.items.isEmpty())
        assertEquals(OpState.PENDING, late.outbox.operation(deleteOpId)!!.state)

        val expired = s1.act(DemoAction.Expire(1, nowElapsedMs = 5_000))
        assertEquals(s1.outbox, expired.outbox)
        assertNull(expired.undo)
        assertSame(expired, expired.act(DemoAction.Undo(1, 5_001)))
    }

    @Test fun supersededDeleteStaysPendingAndOnlyTheLatestIsCoalesced() {
        val s0 = r.emptyState().act(DemoAction.Add("Apple", Category.PRODUCE)).act(DemoAction.Add("Pear", Category.PRODUCE))
        val s1 = s0.act(DemoAction.Delete(s0.items.first { it.name == "Apple" }.id, 0, timeout))
        val firstDelete = s1.undo!!.deleteOpId
        val s2 = s1.act(DemoAction.Delete(s1.items.single().id, 10, timeout))
        val s3 = s2.act(DemoAction.Undo(2, 20))
        assertEquals(listOf("Pear"), s3.items.map { it.name })
        assertEquals(OpState.PENDING, s3.outbox.operation(firstDelete)!!.state)
        assertEquals(OpState.COALESCED_NO_OP, s3.outbox.operation(s2.undo!!.deleteOpId)!!.state)
    }

    @Test fun undoReferencingAnUnknownDeleteIsRefusedAndStateIsUnchanged() {
        val s0 = r.emptyState().act(DemoAction.Add("Ham", Category.MEAT))
        val s1 = s0.act(DemoAction.Delete(s0.items.single().id, 0, timeout))
        val forged = s1.copy(undo = s1.undo!!.copy(deleteOpId = OpId.parse("00000000-0000-4000-b000-000000000999")!!))
        assertSame(forged, forged.act(DemoAction.Undo(1, 1)))
    }

    @Test fun revokedScopeRefusesEveryCommandAndStateIsUnchanged() {
        val s0 = r.emptyState().act(DemoAction.Add("Ham", Category.MEAT))
        val withSlot = s0.act(DemoAction.Delete(s0.items.single().id, 0, timeout))
            .act(DemoAction.Add("Rice", Category.DRY))
        val revoked = withSlot.copy(outbox = (withSlot.outbox.revoke() as Transition.Applied).outbox)
        val rice = revoked.items.single().id
        assertSame(revoked, revoked.act(DemoAction.Add("Peas", Category.FROZEN)))
        assertSame(revoked, revoked.act(DemoAction.Edit(rice, "Brown rice", Category.DRY)))
        assertSame(revoked, revoked.act(DemoAction.Delete(rice, 1, timeout)))
        assertSame(revoked, revoked.act(DemoAction.Undo(1, 1)))
    }

    @Test fun duplicateItemIdAddIsRefusedAndStateIsUnchanged() {
        val fixed = ItemId.parse("00000000-0000-4000-8000-0000000000aa")!!
        val dupIds = FixedItemIds(fixed)
        val s1 = r.reduce(r.emptyState(), DemoAction.Add("Milk", Category.DAIRY), dupIds)
        assertEquals(fixed, s1.items.single().id)
        assertSame(s1, r.reduce(s1, DemoAction.Add("Cream", Category.DAIRY), dupIds))
    }

    @Test fun disallowedCharactersAreRejectedAndEnqueueNothing() {
        val s0 = r.emptyState()
        val bad = listOf(
            withChar("Milk", 0x0A, "Eggs"), // line feed
            withChar("Tea", 0x2028, "time"), // line separator (inside; end whitespace is trimmed)
            withChar("Milk", 0x07), // control
            withChar("Milk", 0x202E), // bidi override
            withChar("Milk", 0x2066, "x"), // bidi isolate
            "a" + 0xD800.toChar() + "b", // unpaired surrogate
        )
        for (name in bad) {
            assertEquals(NameCheck.NotAllowed, r.validateName(name))
            assertSame(s0, s0.act(DemoAction.Add(name, Category.MISC)))
        }
        val s1 = s0.act(DemoAction.Add("Tea", Category.DRY))
        assertSame(s1, s1.act(DemoAction.Edit(s1.items.single().id, withChar("Tea", 0x00, "x"), Category.DRY)))
        // Emoji, including a ZWJ family sequence, remain valid.
        assertTrue(r.validateName(cps(0x1F468, 0x200D, 0x1F469, 0x200D, 0x1F467) + " snacks") is NameCheck.Valid)
    }

    @Test fun visibleItemsAlwaysEqualTheDomainProjection() {
        var s = r.initialState()
        s = s.act(DemoAction.Add("zebra cakes", Category.MISC))
        s = s.act(DemoAction.Add("Avocado", Category.PRODUCE))
        s = s.act(DemoAction.Edit(s.items.first { it.name == "Rice" }.id, "Rice", Category.MISC))
        // Domain order: category ordinal, then case-insensitive name.
        assertEquals(
            listOf("apples", "Avocado", "Bananas", "Oat milk", "Frozen peas", "Rice", "zebra cakes"),
            s.items.map { it.name },
        )
        assertNotNull(s.lastEvent)
        assertFalse(s.ops.isEmpty())
        assertNeverDispatched(s)
    }
}
