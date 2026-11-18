package com.penningtonlabs.baileyscart.demo

import com.penningtonlabs.baileyscart.core.model.offline.AccountKey
import com.penningtonlabs.baileyscart.core.model.offline.Category
import com.penningtonlabs.baileyscart.core.model.offline.FamilyEpoch
import com.penningtonlabs.baileyscart.core.model.offline.FamilyKey
import com.penningtonlabs.baileyscart.core.model.offline.FamilyOutbox
import com.penningtonlabs.baileyscart.core.model.offline.Transition
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** LP-2 D1: the pure helpers that persistence uses (seed for a store key, rebuild from an outbox). */
class LocalDemoListRecoveryTest {
    private val storeKey = FamilyKey(checkNotNull(AccountKey.of("feedfacefeedfacefeedfacefeedface")), LocalDemoList.DEMO_FAMILY)

    @Test fun inMemoryInitialStateIsUnchangedByTheRefactor() {
        val s = LocalDemoList.initialState()
        assertEquals(LocalDemoList.DEMO_KEY, s.outbox.key)
        assertEquals(listOf("apples", "Bananas", "Oat milk", "Rice", "Frozen peas"), s.items.map { it.name })
        assertEquals(LocalDemoList.fromOutbox(LocalDemoList.seededOutbox()), s)
    }

    @Test fun seedForAStoreKeyIsDeterministicAndScopedToThatKey() {
        val a = LocalDemoList.seededOutbox(storeKey)
        assertEquals(a, LocalDemoList.seededOutbox(storeKey))
        assertTrue(a.operations.all { it.key == storeKey })
        assertEquals(5, a.operations.size)
    }

    @Test fun rebuildingFromAnOutboxRestoresItemsButNeverAnUndoSlotOrEvent() {
        var s = LocalDemoList.initialState(storeKey)
        val rice = s.items.single { it.name == "Rice" }.id
        s = LocalDemoList.reduce(s, DemoAction.Delete(rice, 0, LocalDemoList.UNDO_TIMEOUT_MS), SeqIds())
        val rebuilt = LocalDemoList.fromOutbox(s.outbox)!!
        assertEquals(s.items, rebuilt.items)
        assertNull(rebuilt.undo)
        assertNull(rebuilt.lastEvent)
        assertEquals(1L, rebuilt.nextGeneration)
    }

    @Test fun anOutboxAtAnotherEpochOrRevokedIsRefused() {
        assertNull(LocalDemoList.fromOutbox(FamilyOutbox.empty(storeKey, checkNotNull(FamilyEpoch.of(2)))))
        val revoked = (LocalDemoList.seededOutbox(storeKey).revoke() as Transition.Applied).outbox
        assertNull(LocalDemoList.fromOutbox(revoked))
    }

    @Test fun reducerKeepsTheStoreKeyForNewOperations() {
        val s = LocalDemoList.reduce(LocalDemoList.initialState(storeKey), DemoAction.Add("Eggs", Category.DAIRY), SeqIds())
        assertEquals(storeKey, s.outbox.operations.last().key)
    }
}
