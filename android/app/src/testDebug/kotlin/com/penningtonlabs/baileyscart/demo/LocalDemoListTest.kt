package com.penningtonlabs.baileyscart.demo

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

/** BC-UI-S1 D1: LOCAL DEMO reducer (PL-PP-WP01-01..04). */
class LocalDemoListTest {
    private val r = LocalDemoList
    private val timeout = LocalDemoList.UNDO_TIMEOUT_MS

    private fun empty() = DemoListState(items = emptyList(), nextId = 1, undo = null, nextGeneration = 1, lastEvent = null)
    private fun DemoListState.add(name: String, c: DemoCategory) = r.reduce(this, DemoAction.Add(name, c))
    private fun DemoListState.names(c: DemoCategory) = itemsIn(c).map { it.name }
    private fun DemoListState.idOf(name: String) = items.single { it.name == name }.id

    // --- PL-PP-WP01-01: categories, ordering, empty categories ---

    @Test fun categoriesAreTheSixInFixedOrder() {
        assertEquals(
            listOf("PRODUCE", "DAIRY", "DRY", "FROZEN", "MISC", "MEAT"),
            DemoCategory.entries.map { it.name },
        )
    }

    @Test fun seedLeavesMiscAndMeatEmptyAndIsSortedCaseInsensitively() {
        val s = r.initialState()
        assertEquals(listOf("apples", "Bananas"), s.names(DemoCategory.PRODUCE))
        assertTrue(s.itemsIn(DemoCategory.MISC).isEmpty())
        assertTrue(s.itemsIn(DemoCategory.MEAT).isEmpty())
        assertNull(s.undo)
    }

    @Test fun sortIsCaseInsensitiveWithStableTieBreakers() {
        val s = empty()
            .add("banana", DemoCategory.PRODUCE)
            .add("Apple", DemoCategory.PRODUCE)
            .add("apple", DemoCategory.PRODUCE)
            .add("Cherry", DemoCategory.PRODUCE)
            .add("Apple", DemoCategory.PRODUCE)
        // Case-insensitive primary key; exact name ("A" < "a") second; insertion id last.
        assertEquals(listOf("Apple", "Apple", "apple", "banana", "Cherry"), s.names(DemoCategory.PRODUCE))
        val apples = s.itemsIn(DemoCategory.PRODUCE).filter { it.name == "Apple" }.map { it.id }
        assertEquals(apples.sorted(), apples)
        // Repeated evaluation is deterministic.
        assertEquals(s.itemsIn(DemoCategory.PRODUCE), s.itemsIn(DemoCategory.PRODUCE))
    }

    // --- PL-PP-WP01-02: add, edit, validation ---

    @Test fun addTrimsNameAndAssignsCategory() {
        val s = empty().add("  Eggs  ", DemoCategory.DAIRY)
        assertEquals(listOf("Eggs"), s.names(DemoCategory.DAIRY))
        assertEquals(DemoEvent.Added(s.items.single()), s.lastEvent)
    }

    @Test fun blankAndWhitespaceOnlyNamesAreRejectedWithoutStateChange() {
        val s0 = empty()
        for (bad in listOf("", " ", "\t\n  ")) {
            assertEquals(NameCheck.Blank, r.validateName(bad))
            assertSame(s0, s0.add(bad, DemoCategory.MISC))
        }
    }

    @Test fun nameLimitIsOneHundredCodePointsAfterTrim() {
        val ok = "a".repeat(100)
        assertEquals(NameCheck.Valid(ok), r.validateName("  $ok  "))
        assertEquals(NameCheck.TooLong, r.validateName("a".repeat(101)))
        // Code points, not UTF-16 units: 100 emoji are 200 chars but valid.
        val emoji = "🍎".repeat(100)
        assertEquals(NameCheck.Valid(emoji), r.validateName(emoji))
        assertEquals(NameCheck.TooLong, r.validateName(emoji + "🍎"))
    }

    @Test fun duplicateNamesAreNotCanonicalizedOrMerged() {
        // W-03 canonical NameKey is OPEN: the demo must not invent dedup rules.
        val s = empty().add("Milk", DemoCategory.DAIRY).add("milk", DemoCategory.DAIRY)
        assertEquals(2, s.items.size)
    }

    @Test fun editRenamesAndMovesCategoryAndResorts() {
        var s = empty().add("Zucchini", DemoCategory.PRODUCE).add("Kale", DemoCategory.PRODUCE)
        s = r.reduce(s, DemoAction.Edit(s.idOf("Zucchini"), " avocado ", DemoCategory.PRODUCE))
        assertEquals(listOf("avocado", "Kale"), s.names(DemoCategory.PRODUCE))
        val id = s.idOf("Kale")
        s = r.reduce(s, DemoAction.Edit(id, "Kale chips", DemoCategory.DRY))
        assertEquals(listOf("avocado"), s.names(DemoCategory.PRODUCE))
        assertEquals(listOf("Kale chips"), s.names(DemoCategory.DRY))
        assertEquals(id, s.idOf("Kale chips"))
        assertEquals(DemoEvent.Updated(s.items.single { it.id == id }), s.lastEvent)
    }

    @Test fun invalidOrUnknownOrNoOpEditLeavesStateUnchanged() {
        val s = empty().add("Bread", DemoCategory.DRY)
        val id = s.idOf("Bread")
        assertSame(s, r.reduce(s, DemoAction.Edit(id, "   ", DemoCategory.DRY)))
        assertSame(s, r.reduce(s, DemoAction.Edit(999, "Toast", DemoCategory.DRY)))
        assertSame(s, r.reduce(s, DemoAction.Edit(id, " Bread ", DemoCategory.DRY)))
    }

    // --- PL-PP-WP01-03: latest-only delete and Undo ---

    @Test fun deleteRemovesItemAndOpensUndoSlotOnMonotonicClock() {
        val s0 = empty().add("Cheese", DemoCategory.DAIRY)
        val item = s0.items.single()
        val s = r.reduce(s0, DemoAction.Delete(item.id, nowElapsedMs = 1_000, timeoutMs = timeout))
        assertTrue(s.items.isEmpty())
        assertEquals(UndoSlot(generation = 1, item = item, expiresAtElapsedMs = 6_000), s.undo)
        assertEquals(DemoEvent.Deleted(item), s.lastEvent)
    }

    @Test fun undoBeforeExpiryRestoresExactItemOnce() {
        val s0 = empty().add("Ham", DemoCategory.MEAT)
        val item = s0.items.single()
        val s1 = r.reduce(s0, DemoAction.Delete(item.id, 0, timeout))
        val s2 = r.reduce(s1, DemoAction.Undo(s1.undo!!.generation, nowElapsedMs = 4_999))
        assertEquals(listOf(item), s2.items)
        assertNull(s2.undo)
        assertEquals(DemoEvent.Restored(item), s2.lastEvent)
        // Repeated Undo (fast double tap) is idempotent: no duplicate restoration.
        val s3 = r.reduce(s2, DemoAction.Undo(1, nowElapsedMs = 5_000 - 1))
        assertSame(s2, s3)
        assertEquals(1, s3.items.size)
    }

    @Test fun undoAtOrAfterExpiryBoundaryDoesNotRestore() {
        val s0 = empty().add("Ham", DemoCategory.MEAT)
        val s1 = r.reduce(s0, DemoAction.Delete(s0.items.single().id, 0, timeout))
        val atBoundary = r.reduce(s1, DemoAction.Undo(1, nowElapsedMs = 5_000))
        assertTrue(atBoundary.items.isEmpty())
        assertNull(atBoundary.undo)
        assertTrue(r.reduce(s1, DemoAction.Undo(1, nowElapsedMs = 60_000)).items.isEmpty())
    }

    @Test fun expiryClearsSlotOnlyAtOrAfterBoundary() {
        val s0 = empty().add("Ham", DemoCategory.MEAT)
        val s1 = r.reduce(s0, DemoAction.Delete(s0.items.single().id, 0, timeout))
        assertSame(s1, r.reduce(s1, DemoAction.Expire(1, nowElapsedMs = 4_999)))
        val s2 = r.reduce(s1, DemoAction.Expire(1, nowElapsedMs = 5_000))
        assertNull(s2.undo)
        assertTrue(s2.items.isEmpty())
        // After expiry, a late Undo cannot resurrect the item.
        assertSame(s2, r.reduce(s2, DemoAction.Undo(1, nowElapsedMs = 5_000)))
    }

    @Test fun secondDeleteReplacesSlotAndFirstDeletionBecomesFinal() {
        val s0 = empty().add("Apple", DemoCategory.PRODUCE).add("Pear", DemoCategory.PRODUCE)
        val apple = s0.items.single { it.name == "Apple" }
        val pear = s0.items.single { it.name == "Pear" }
        val s1 = r.reduce(s0, DemoAction.Delete(apple.id, 0, timeout))
        val s2 = r.reduce(s1, DemoAction.Delete(pear.id, 10, timeout)) // rapid double delete
        assertEquals(2L, s2.undo!!.generation)
        assertEquals(pear, s2.undo.item)
        // An Undo for the superseded slot does nothing.
        assertSame(s2, r.reduce(s2, DemoAction.Undo(1, 20)))
        val s3 = r.reduce(s2, DemoAction.Undo(2, 20))
        assertEquals(listOf(pear), s3.items)
    }

    @Test fun oldTimerCannotDismissNewerSlot() {
        val s0 = empty().add("Apple", DemoCategory.PRODUCE).add("Pear", DemoCategory.PRODUCE)
        val s1 = r.reduce(s0, DemoAction.Delete(s0.idOf("Apple"), 0, timeout))
        val s2 = r.reduce(s1, DemoAction.Delete(s1.idOf("Pear"), 4_000, timeout))
        // The first slot's timer fires late, at its own boundary and beyond.
        assertSame(s2, r.reduce(s2, DemoAction.Expire(1, 5_000)))
        assertSame(s2, r.reduce(s2, DemoAction.Expire(1, 8_999)))
        assertEquals(9_000L, s2.undo!!.expiresAtElapsedMs)
        assertNull(r.reduce(s2, DemoAction.Expire(2, 9_000)).undo)
    }

    @Test fun noStaleSlotResurrectionAfterUndoThenDelete() {
        var s = empty().add("Apple", DemoCategory.PRODUCE).add("Pear", DemoCategory.PRODUCE)
        val apple = s.items.single { it.name == "Apple" }
        s = r.reduce(s, DemoAction.Delete(apple.id, 0, timeout))
        s = r.reduce(s, DemoAction.Undo(1, 1))
        s = r.reduce(s, DemoAction.Delete(s.idOf("Pear"), 2, timeout))
        // Replaying the consumed generation-1 Undo must not restore Apple twice or drop Pear's slot.
        val replay = r.reduce(s, DemoAction.Undo(1, 3))
        assertSame(s, replay)
        assertEquals(listOf(apple), replay.items)
        assertEquals(2L, replay.undo!!.generation)
    }

    @Test fun deleteOfUnknownItemIsNoOp() {
        val s = empty().add("Apple", DemoCategory.PRODUCE)
        assertSame(s, r.reduce(s, DemoAction.Delete(42, 0, timeout)))
    }

    @Test fun extendedAccessibilityTimeoutIsHonored() {
        val s0 = empty().add("Ham", DemoCategory.MEAT)
        val s1 = r.reduce(s0, DemoAction.Delete(s0.items.single().id, 0, timeoutMs = 20_000))
        assertEquals(1, r.reduce(s1, DemoAction.Undo(1, 19_999)).items.size)
        assertSame(s1, r.reduce(s1, DemoAction.Expire(1, 19_999)))
    }

    @Test fun negativeTimeoutIsClampedToImmediateExpiry() {
        val s0 = empty().add("Ham", DemoCategory.MEAT)
        val s1 = r.reduce(s0, DemoAction.Delete(s0.items.single().id, 100, timeoutMs = -5))
        assertEquals(100L, s1.undo!!.expiresAtElapsedMs)
        assertTrue(r.reduce(s1, DemoAction.Undo(1, 100)).items.isEmpty())
    }
}
