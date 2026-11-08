package com.penningtonlabs.baileyscart.core.model.offline

import com.penningtonlabs.baileyscart.core.model.offline.Fx.A1
import com.penningtonlabs.baileyscart.core.model.offline.Fx.A2
import com.penningtonlabs.baileyscart.core.model.offline.Fx.B1
import com.penningtonlabs.baileyscart.core.model.offline.Fx.E1
import com.penningtonlabs.baileyscart.core.model.offline.Fx.E2
import com.penningtonlabs.baileyscart.core.model.offline.Fx.add
import com.penningtonlabs.baileyscart.core.model.offline.Fx.delete
import com.penningtonlabs.baileyscart.core.model.offline.Fx.edit
import com.penningtonlabs.baileyscart.core.model.offline.Fx.item
import com.penningtonlabs.baileyscart.core.model.offline.Fx.op
import com.penningtonlabs.baileyscart.core.model.offline.Fx.undo
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Snapshot plus pending-overlay projection (WP02-02/04/05/06 support) and the storage port fakes. */
class ProjectionAndPortsTest {
    private fun snap(vararg items: ServerItem, key: FamilyKey = A1, epoch: FamilyEpoch = E1) = ServerSnapshot(key, epoch, items.toList())
    private fun srv(n: Int, name: String, c: Category = Category.PRODUCE, v: Long = 1) = ServerItem(item(n), name, c, v)

    private fun render(s: ServerSnapshot, o: FamilyOutbox): List<ProjectedItem> =
        (ListProjector.project(s, o) as ProjectionResult.Projected).projection.items

    @Test fun pendingOverlaysRenderOnTopOfAnUnchangedSnapshot() {
        val s = snap(srv(1, "Milk", Category.DAIRY))
        val before = s.copy()
        val o = FamilyOutbox.empty(A1, E1).q(op(1), add(item(2), "apples")).q(op(2), edit(item(1), null, Category.MISC))
        val items = render(s, o)
        assertEquals(listOf("apples" to SyncMark.PENDING, "Milk" to SyncMark.PENDING), items.map { it.name to it.sync })
        assertEquals(Category.MISC, items.single { it.itemId == item(1) }.category)
        assertEquals(before, s) // the snapshot is never modified
        assertEquals(items, render(s, o)) // deterministic
    }

    @Test fun lookAlikeSnapshotItemNeverRetiresAPendingOverlay() {
        val ours = item(2)
        val o = FamilyOutbox.empty(A1, E1).q(op(1), add(ours, "Milk")).dispatchNext().sent().first
        // The server snapshot shows a visually identical "Milk" under another member's id.
        val s = snap(srv(9, "Milk"))
        val items = render(s, o)
        assertEquals(2, items.size)
        assertEquals(SyncMark.PENDING, items.single { it.itemId == ours }.sync)
        // Negative: the look-alike did not commit or retire our operation.
        assertEquals(OpState.IN_FLIGHT, o.state(op(1)))
    }

    @Test fun committedOverlayStaysUntilSnapshotShowsThatVersion() {
        val id = item(2)
        val o = FamilyOutbox.empty(A1, E1).q(op(1), add(id, "Milk")).sendAndCommit(version = 4).first
        // Response before snapshot: committed but the snapshot lags, so it still renders (as synced).
        assertEquals(listOf("Milk" to SyncMark.SYNCED), render(snap(), o).map { it.name to it.sync })
        // Snapshot catches up: the snapshot is authoritative (another member's later rename wins).
        assertEquals(listOf("Whole milk"), render(snap(srv(2, "Whole milk", v = 5)), o).map { it.name })
    }

    @Test fun pendingDeleteBeatsPendingEditAndNeverResurrects() {
        val s = snap(srv(1, "Milk"))
        val editThenDelete = FamilyOutbox.empty(A1, E1).q(op(1), edit(item(1), "Oat milk")).q(op(2), delete(item(1)))
        assertTrue(render(s, editThenDelete).isEmpty())
        val deleteThenEdit = FamilyOutbox.empty(A1, E1).q(op(1), delete(item(1))).q(op(2), edit(item(1), "Oat milk"))
        assertTrue(render(s, deleteThenEdit).isEmpty())
    }

    @Test fun rejectedAndBlockedNeverRenderAsCommitted() {
        val id = item(2)
        val o = FamilyOutbox.empty(A1, E1).q(op(1), add(id, "Milk")).q(op(2), edit(id, "Oat milk"))
            .dispatchNext().sent().first.recordRejected(A1, op(1), ServerErrorCode("DUPLICATE_NAME_EXISTS")).applied()
        val p = (ListProjector.project(snap(), o) as ProjectionResult.Projected).projection
        assertTrue(p.items.isEmpty())
        assertEquals(listOf(OpState.REJECTED_TERMINAL, OpState.BLOCKED_DEPENDENCY), p.attention.map { it.state })
    }

    @Test fun undoRendersFromCapturedImageAndCoalescedPairShowsSnapshot() {
        val image = ItemImage(item(1), "Milk", Category.DAIRY)
        // The committed delete is reflected in the snapshot (item gone) and Undo is pending: render from the pre-image.
        val o = FamilyOutbox.empty(A1, E1).q(op(1), delete(item(1)), image).sendAndCommit(3).first.q(op(2), undo(item(1), op(1)))
        assertEquals(listOf("Milk" to SyncMark.PENDING), render(snap(), o).map { it.name to it.sync })
        // Coalesced: no overlay at all, and the snapshot item is shown as synced.
        val c = FamilyOutbox.empty(A1, E1).q(op(1), delete(item(1)), image).q(op(2), undo(item(1), op(1)))
        assertEquals(listOf("Milk" to SyncMark.SYNCED), render(snap(srv(1, "Milk", Category.DAIRY)), c).map { it.name to it.sync })
    }

    @Test fun foreignOrStaleSnapshotsAreRefused() {
        val o = FamilyOutbox.empty(A1, E2)
        assertEquals(ProjectionResult.Refused(ProjectionRefusal.SCOPE_MISMATCH), ListProjector.project(snap(key = A2, epoch = E2), o))
        assertEquals(ProjectionResult.Refused(ProjectionRefusal.SCOPE_MISMATCH), ListProjector.project(snap(key = B1, epoch = E2), o))
        assertEquals(ProjectionResult.Refused(ProjectionRefusal.STALE_SNAPSHOT), ListProjector.project(snap(epoch = E1), o))
        assertEquals(ProjectionResult.Refused(ProjectionRefusal.FUTURE_SNAPSHOT), ListProjector.project(snap(epoch = E2), FamilyOutbox.empty(A1, E1)))
        assertEquals(ProjectionResult.Refused(ProjectionRefusal.DUPLICATE_ITEM_ID), ListProjector.project(snap(srv(1, "a"), srv(1, "b")), FamilyOutbox.empty(A1, E1)))
    }

    @Test fun sortIsCategoryThenCaseInsensitiveName() {
        val s = snap(srv(1, "banana"), srv(2, "Apple"), srv(3, "cheese", Category.DAIRY), srv(4, "apple"))
        assertEquals(listOf("Apple", "apple", "banana", "cheese"), render(s, FamilyOutbox.empty(A1, E1)).map { it.name })
    }

    // ---- storage ports (test-only fakes) -----------------------------------------------

    @Test fun inMemoryOutboxStoreIsScopedAndCompareAndSet() {
        val store = InMemoryOutboxStore()
        val a = FamilyOutbox.empty(A1, E1)
        assertTrue(store.compareAndSet(A1, null, a))
        assertFalse(store.compareAndSet(A1, null, a)) // the expected value no longer matches
        val a2 = a.q(op(1), add(item(1), "Milk"))
        assertTrue(store.compareAndSet(A1, a, a2))
        assertFalse(store.compareAndSet(A1, a, a2)) // a stale writer loses
        assertEquals(a2, store.read(A1))
        assertNull(store.read(A2))
        assertNull(store.read(B1))
        // Negative: writing an outbox under another scope's key is impossible.
        assertFalse(store.compareAndSet(B1, null, a))
        assertNull(store.read(B1))
    }

    @Test fun inMemoryLocalListStoreIsScoped() {
        val store = InMemoryLocalListStore()
        store.replace(snap(srv(1, "Milk")))
        store.replace(snap(srv(2, "Eggs"), key = A2))
        assertEquals(listOf("Milk"), store.read(A1)!!.items.map { it.name })
        assertEquals(listOf("Eggs"), store.read(A2)!!.items.map { it.name })
        assertNull(store.read(B1))
    }
}

/** Test-only fake. Atomic CAS per key; refuses a key/value mismatch. */
class InMemoryOutboxStore : OutboxStore {
    private val data = HashMap<FamilyKey, FamilyOutbox>()

    @Synchronized override fun read(key: FamilyKey): FamilyOutbox? = data[key]

    @Synchronized override fun compareAndSet(key: FamilyKey, expected: FamilyOutbox?, updated: FamilyOutbox): Boolean {
        if (updated.key != key || data[key] != expected) return false
        data[key] = updated
        return true
    }
}

/** Test-only fake. One snapshot per key. */
class InMemoryLocalListStore : LocalListStore {
    private val data = HashMap<FamilyKey, ServerSnapshot>()

    @Synchronized override fun read(key: FamilyKey): ServerSnapshot? = data[key]

    @Synchronized override fun replace(snapshot: ServerSnapshot) {
        data[snapshot.key] = snapshot
    }
}
