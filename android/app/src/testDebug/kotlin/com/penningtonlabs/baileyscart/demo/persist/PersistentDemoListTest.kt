package com.penningtonlabs.baileyscart.demo.persist

import com.penningtonlabs.baileyscart.core.model.offline.Category
import com.penningtonlabs.baileyscart.core.model.offline.FamilyEpoch
import com.penningtonlabs.baileyscart.core.model.offline.FamilyOutbox
import com.penningtonlabs.baileyscart.core.model.offline.ItemCommand
import com.penningtonlabs.baileyscart.demo.DemoAction
import com.penningtonlabs.baileyscart.demo.LocalDemoList
import com.penningtonlabs.baileyscart.demo.SeqIds
import com.penningtonlabs.baileyscart.demo.showsGenericLockedBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.Executor

/**
 * BC-S2-LOCAL-PERSIST LP-2 D1: seed once, restart recovery, commit before render, ordered
 * writes, fail closed and user-confirmed reset, over a fake store (no Android, no SQLCipher).
 */
class PersistentDemoListTest {
    private val timeout = LocalDemoList.UNDO_TIMEOUT_MS
    private val store = FakeDemoStore()
    private val published = mutableListOf<DemoScreen>()

    /** Runs each task immediately, in order (a serial executor with no concurrency). */
    private val direct = Executor { it.run() }

    /** Holds tasks until [runAll], to prove ordering and that nothing renders before it runs. */
    private class QueueExecutor : Executor {
        val tasks = ArrayDeque<Runnable>()
        override fun execute(command: Runnable) {
            tasks.addLast(command)
        }

        fun runAll() {
            while (tasks.isNotEmpty()) tasks.removeFirst().run()
        }
    }

    private fun controller(executor: Executor = direct, ids: SeqIds = SeqIds()) =
        PersistentDemoList(store, executor, { published += it }, ids)

    private fun launch(executor: Executor = direct, ids: SeqIds = SeqIds()): PersistentDemoList =
        controller(executor, ids).also { it.start() }

    /** Simulates process death: the old controller is abandoned (no close), a new one starts. */
    private fun relaunch(ids: SeqIds = SeqIds(1000)): PersistentDemoList {
        published.clear()
        return launch(ids = ids)
    }

    private val last: DemoScreen get() = published.last()
    private val ready: DemoScreen.Ready get() = last as DemoScreen.Ready
    private fun names(s: DemoScreen.Ready) = s.list.items.map { it.name }
    private val seedNames = LocalDemoList.initialState().items.map { it.name }
    private val seedCasCount get() = store.casCalls.count { it.expected == null }

    // ---- seed once ---------------------------------------------------------------------------

    @Test fun firstLaunchSeedsOnceAgainstAnAbsentScopeThenRendersTheCommittedSeed() {
        launch()
        assertEquals(listOf(DemoScreen.Opening::class, DemoScreen.Ready::class), published.map { it::class })
        assertEquals(seedNames, names(ready))
        val cas = store.casCalls.single()
        assertNull(cas.expected)
        assertTrue(cas.applied)
        assertEquals(LocalDemoList.seededOutbox(store.key), store.stored)
        assertEquals(store.key, ready.list.outbox.key)
    }

    @Test fun restartRecoversTheSavedListAndNeverSeedsAgain() {
        launch().dispatch(DemoAction.Add("Eggs", Category.DAIRY))
        val before = names(ready)
        repeat(3) { relaunch() }
        assertEquals(before, names(ready))
        assertEquals(1, seedCasCount)
        assertTrue("Eggs" in names(ready))
    }

    @Test fun addEditDeleteAndUndoAllSurviveRestartExactly() {
        val c = launch()
        c.dispatch(DemoAction.Add("Eggs", Category.DAIRY))
        val eggs = ready.list.items.single { it.name == "Eggs" }.id
        c.dispatch(DemoAction.Edit(eggs, "Free-range eggs", Category.MISC))
        val rice = ready.list.items.single { it.name == "Rice" }.id
        c.dispatch(DemoAction.Delete(rice, nowElapsedMs = 0, timeoutMs = timeout))
        c.dispatch(DemoAction.Undo(ready.list.undo!!.generation, nowElapsedMs = 1))
        val bananas = ready.list.items.single { it.name == "Bananas" }.id
        c.dispatch(DemoAction.Delete(bananas, nowElapsedMs = 2, timeoutMs = timeout))
        val beforeItems = ready.list.items
        val beforeOutbox = ready.list.outbox

        relaunch()
        assertEquals(beforeItems, ready.list.items)
        assertEquals(beforeOutbox, ready.list.outbox)
        assertTrue(ready.list.items.any { it.name == "Free-range eggs" && it.category == Category.MISC })
        assertTrue(ready.list.items.any { it.name == "Rice" })
        assertFalse(ready.list.items.any { it.name == "Bananas" })
    }

    @Test fun undoWindowIsNotRestoredAfterRestartAndTheDeleteStands() {
        val c = launch()
        val rice = ready.list.items.single { it.name == "Rice" }.id
        c.dispatch(DemoAction.Delete(rice, nowElapsedMs = 0, timeoutMs = timeout))
        assertNotNull(ready.list.undo)
        val c2 = relaunch()
        assertNull(ready.list.undo)
        assertNull(ready.list.lastEvent)
        assertFalse(ready.list.items.any { it.id == rice })
        // An Undo for the old slot after restart does nothing and writes nothing.
        val writes = store.casCalls.size
        c2.dispatch(DemoAction.Undo(generation = 1, nowElapsedMs = 1))
        assertEquals(writes, store.casCalls.size)
        assertFalse(ready.list.items.any { it.id == rice })
    }

    // ---- commit before render and ordering ---------------------------------------------------

    @Test fun aChangeIsRenderedOnlyAfterItsCommitSucceeded() {
        val c = launch()
        var renderedBeforeCommit = false
        store.onCas = { _, _ ->
            renderedBeforeCommit = published.any { s -> s is DemoScreen.Ready && s.list.items.any { it.name == "Eggs" } }
        }
        val publishedBefore = published.size
        c.dispatch(DemoAction.Add("Eggs", Category.DAIRY))
        assertFalse("rendered before commit", renderedBeforeCommit)
        assertEquals(publishedBefore + 1, published.size)
        assertTrue(names(ready).contains("Eggs"))
        assertEquals(store.stored, ready.list.outbox)
    }

    @Test fun aRefusedCommitIsNeverRenderedAndPausesEditingUntilReload() {
        val c = launch()
        val committed = ready.list
        store.casResult = false
        c.dispatch(DemoAction.Add("Eggs", Category.DAIRY))
        val failed = last as DemoScreen.SaveFailed
        assertSame(committed, failed.list)
        assertTrue(published.none { s -> s is DemoScreen.Ready && s.list.items.any { it.name == "Eggs" } })

        // Editing is paused: no further write is attempted.
        val writes = store.casCalls.size
        c.dispatch(DemoAction.Add("Milk", Category.DAIRY))
        assertEquals(writes, store.casCalls.size)

        // Reload re-reads the disk.
        store.casResult = null
        c.reload()
        assertEquals(seedNames, names(ready))
        assertEquals(store.stored, ready.list.outbox)
        c.dispatch(DemoAction.Add("Milk", Category.DAIRY))
        assertTrue("Milk" in names(ready))
    }

    @Test fun aThrowingCommitIsASaveFailureNotARender() {
        val c = launch()
        val committed = ready.list
        store.casThrows = true
        c.dispatch(DemoAction.Add("Eggs", Category.DAIRY))
        assertEquals(DemoScreen.SaveFailed(committed), last)
        assertEquals(LocalDemoList.seededOutbox(store.key), store.stored)
    }

    @Test fun rapidActionsCommitInSubmissionOrderEachAgainstThePreviousCommit() {
        val q = QueueExecutor()
        val c = launch(q)
        val names = (1..25).map { "Item %02d".format(it) }
        names.forEach { c.dispatch(DemoAction.Add(it, Category.MISC)) }
        assertTrue("nothing renders before the persistence thread runs", published.isEmpty())
        q.runAll()
        val writes = store.casCalls.drop(1) // after the seed
        assertEquals(25, writes.size)
        assertTrue(writes.all { it.applied })
        writes.zipWithNext().forEach { (a, b) -> assertEquals(a.updated, b.expected) }
        writes.forEachIndexed { i, w -> assertEquals(names[i], (w.updated.operations.last().command as? ItemCommand.Add)?.name?.display) }
        assertEquals(names, ready.list.itemsIn(Category.MISC).map { it.name })
        // Each published Ready contains exactly the committed outbox at that point.
        val readies = published.filterIsInstance<DemoScreen.Ready>()
        assertEquals(store.casCalls.map { it.updated }, readies.map { it.list.outbox })
    }

    @Test fun undoExpiryIsUiOnlyAndWritesNothing() {
        val c = launch()
        val rice = ready.list.items.single { it.name == "Rice" }.id
        c.dispatch(DemoAction.Delete(rice, nowElapsedMs = 0, timeoutMs = timeout))
        val writes = store.casCalls.size
        c.dispatch(DemoAction.Expire(ready.list.undo!!.generation, nowElapsedMs = timeout))
        assertNull(ready.list.undo)
        assertEquals(writes, store.casCalls.size)
    }

    // ---- fail closed -------------------------------------------------------------------------

    @Test fun everyStorageLockIsShownAndNeverSeedsWritesResetsOrRecreates() {
        val reasons = StoreLock.entries.filter { it != StoreLock.STATE_UNREADABLE && it != StoreLock.OPEN_ERROR }
        for (reason in reasons) {
            val s = FakeDemoStore().apply { lock = DemoStoreOpen.Locked(reason, canSetAside = reason != StoreLock.TAG_KEY_MISSING) }
            val out = mutableListOf<DemoScreen>()
            val c = PersistentDemoList(s, direct, { out += it }, SeqIds())
            c.start()
            c.dispatch(DemoAction.Add("Eggs", Category.DAIRY))
            c.reload()
            assertEquals(reason, (out.last() as DemoScreen.Locked).reason)
            assertTrue(reason.name, s.casCalls.isEmpty())
            assertEquals(0, s.purges)
            assertEquals(0, s.setAsides)
            assertNull(s.stored)
            assertTrue(out.none { it is DemoScreen.Ready })
        }
    }

    @Test fun anUnreadableStoredOutboxIsLockedNotTreatedAsEmpty() {
        store.stored = LocalDemoList.seededOutbox(store.key)
        store.recoverThrows = true
        launch()
        assertEquals(DemoScreen.Locked(StoreLock.STATE_UNREADABLE, canReset = true), last)
        assertTrue(store.casCalls.isEmpty())
        assertEquals(LocalDemoList.seededOutbox(store.key), store.stored)
        assertEquals(0, store.openSessions)
    }

    @Test fun aRecoveredOutboxThatTheProjectorRefusesIsLocked() {
        store.stored = FamilyOutbox.empty(store.key, checkNotNull(FamilyEpoch.of(2)))
        launch()
        assertEquals(StoreLock.STATE_UNREADABLE, (last as DemoScreen.Locked).reason)
        assertTrue(store.casCalls.isEmpty())
    }

    @Test fun anAbsentDemoScopeInANonEmptyStoreIsNotSeeded() {
        store.otherScopes = 1
        launch()
        assertEquals(StoreLock.STATE_UNREADABLE, (last as DemoScreen.Locked).reason)
        assertTrue(store.casCalls.isEmpty())
    }

    @Test fun aLostSeedCompareAndSetFailsClosedAndDoesNotRetry() {
        store.casResult = false
        launch()
        assertEquals(StoreLock.STATE_UNREADABLE, (last as DemoScreen.Locked).reason)
        assertEquals(1, store.casCalls.size)
        assertNull(store.stored)
    }

    @Test fun anOpenExceptionIsLockedWithoutReset() {
        store.openThrows = true
        val c = launch()
        assertEquals(DemoScreen.Locked(StoreLock.OPEN_ERROR, canReset = false), last)
        c.reset()
        assertEquals(0, store.setAsides)
        assertEquals(0, store.purges)
    }

    @Test fun nothingIsEditableWhileLocked() {
        store.lock = DemoStoreOpen.Locked(StoreLock.KEY_MISSING, canSetAside = true)
        val c = launch()
        c.dispatch(DemoAction.Add("Eggs", Category.DAIRY))
        assertTrue(store.casCalls.isEmpty())
        assertTrue(published.none { it is DemoScreen.Ready })
    }

    @Test fun tryAgainReopensAndRecoversOnceTheLockClears() {
        store.stored = LocalDemoList.seededOutbox(store.key)
        store.lock = DemoStoreOpen.Locked(StoreLock.KEY_TRANSIENT, canSetAside = true)
        val c = launch()
        store.lock = null
        c.reload()
        assertEquals(seedNames, names(ready))
        assertEquals(0, seedCasCount)
    }

    // ---- user-confirmed reset ----------------------------------------------------------------

    @Test fun noResetHappensWithoutTheConfirmedResetCall() {
        val c = launch()
        c.dispatch(DemoAction.Add("Eggs", Category.DAIRY))
        relaunch()
        assertEquals(0, store.purges)
        assertEquals(0, store.setAsides)
    }

    @Test fun confirmedHealthyResetPurgesThenSeedsOnceAndSaysSo() {
        val c = launch()
        c.dispatch(DemoAction.Add("Eggs", Category.DAIRY))
        c.reset()
        assertEquals(1, store.purges)
        assertTrue(DemoScreen.Resetting in published)
        assertEquals(DemoNotice.RESET_DONE, ready.notice)
        assertEquals(seedNames, names(ready))
        assertEquals(LocalDemoList.seededOutbox(store.key), store.stored)
        assertEquals(2, seedCasCount)
        assertEquals(1, store.openSessions)
    }

    @Test fun aFailedHealthyResetIsReportedAsFailedAndKeepsTheSavedList() {
        val c = launch()
        c.dispatch(DemoAction.Add("Eggs", Category.DAIRY))
        val saved = store.stored
        store.purgeThrows = true
        c.reset()
        assertEquals(DemoNotice.RESET_FAILED, ready.notice)
        assertTrue("Eggs" in names(ready))
        assertEquals(saved, store.stored)
        assertTrue(published.none { (it as? DemoScreen.Ready)?.notice == DemoNotice.RESET_DONE })
    }

    @Test fun aResetThatCannotStartANewListIsNotReportedAsDone() {
        val c = launch()
        store.casResult = false
        c.reset()
        val locked = last as DemoScreen.Locked
        assertEquals(DemoNotice.RESET_INCOMPLETE, locked.notice)
        assertTrue(published.none { (it as? DemoScreen.Ready)?.notice == DemoNotice.RESET_DONE })
    }

    @Test fun confirmedLockedResetSetsAsideThenStartsANewSeededList() {
        store.lock = DemoStoreOpen.Locked(StoreLock.UNWRAP_FAILED, canSetAside = true)
        val c = launch()
        c.reset()
        assertEquals(1, store.setAsides)
        assertEquals(0, store.purges)
        assertEquals(DemoNotice.RESET_DONE, ready.notice)
        assertEquals(seedNames, names(ready))
    }

    /** Negative control: "Nothing was changed" is still said when the set-aside certainly never started. */
    @Test fun aLockedResetThatCertainlyNeverStartedStaysLockedAndSaysItFailed() {
        store.lock = DemoStoreOpen.Locked(StoreLock.DB_UNREADABLE, canSetAside = true)
        store.setAsideOutcome = SetAsideOutcome.NOT_STARTED
        val c = launch()
        val opensBefore = store.opens
        c.reset()
        assertEquals(DemoScreen.Locked(StoreLock.DB_UNREADABLE, canReset = true, notice = DemoNotice.RESET_FAILED), last)
        assertEquals(opensBefore, store.opens) // nothing to re-read: nothing moved
        assertTrue(store.casCalls.isEmpty())
    }

    @Test fun anUnreadableStateResetClosesTheStoreBeforeSettingAside() {
        store.stored = LocalDemoList.seededOutbox(store.key)
        store.recoverThrows = true
        val c = launch()
        c.reset() // FakeDemoStore.setAside fails the test if a session is still open
        assertEquals(1, store.setAsides)
        assertEquals(DemoNotice.RESET_DONE, ready.notice)
    }

    @Test fun aLockWithoutTheTagKeyCannotBeReset() {
        store.lock = DemoStoreOpen.Locked(StoreLock.TAG_KEY_MISSING, canSetAside = false)
        val c = launch()
        assertFalse((last as DemoScreen.Locked).canReset)
        c.reset()
        assertEquals(0, store.setAsides)
    }

    @Test fun closeReleasesTheSession() {
        val c = launch()
        assertEquals(1, store.openSessions)
        c.close()
        assertEquals(0, store.openSessions)
        assertEquals(1, store.closes)
    }

    // ---- LP-2 reset hardening: unknown outcomes are never "nothing changed" -------------------

    private val locked: DemoScreen.Locked get() = last as DemoScreen.Locked
    private fun saidNothingChanged() = published.any {
        (it as? DemoScreen.Locked)?.notice == DemoNotice.RESET_FAILED || (it as? DemoScreen.Ready)?.notice == DemoNotice.RESET_FAILED
    }

    @Test fun anInterruptedSetAsideIsIncompleteAndNeverReportedAsNothingChanged() {
        store.lock = DemoStoreOpen.Locked(StoreLock.DB_UNREADABLE, canSetAside = true)
        store.setAsideOutcome = SetAsideOutcome.INTERRUPTED
        val c = launch()
        c.reset()
        assertEquals(DemoScreen.Locked(StoreLock.RECOVERY_PENDING, canReset = true, notice = DemoNotice.RESET_INCOMPLETE), last)
        assertFalse(saidNothingChanged())
        assertTrue(store.casCalls.isEmpty()) // nothing seeded over a half-moved store
        assertFalse(showsGenericLockedBody(locked.notice))
    }

    @Test fun aThrowingSetAsideIsAnUnknownOutcomeNotNothingChanged() {
        for (io in listOf(false, true)) {
            published.clear()
            val s = FakeDemoStore().apply {
                lock = DemoStoreOpen.Locked(StoreLock.DB_UNREADABLE, canSetAside = true)
                setAsideThrows = true
                throwsIo = io
            }
            val c = PersistentDemoList(s, direct, { published += it }, SeqIds())
            c.start()
            c.reset() // an IOException must not escape the task
            assertEquals("io=$io", DemoNotice.RESET_INCOMPLETE, locked.notice)
            assertFalse("io=$io", saidNothingChanged())
            assertTrue(s.casCalls.isEmpty())
        }
    }

    @Test fun retryAfterAnIncompleteResetStaysIncompleteAndKeepsTheGenericBodyHidden() {
        // Healthy path: the purge committed, then the new list could not be seeded.
        val c = launch()
        store.casResult = false
        c.reset()
        assertEquals(DemoNotice.RESET_INCOMPLETE, locked.notice)
        repeat(2) {
            c.reload()
            assertEquals(DemoNotice.RESET_INCOMPLETE, locked.notice)
            assertFalse(showsGenericLockedBody(locked.notice))
        }
        // Once the store works, the retry shows that the reset did complete.
        store.casResult = null
        c.reload()
        assertEquals(DemoNotice.RESET_DONE, ready.notice)
        assertEquals(seedNames, names(ready))
        relaunch()
        assertNull("the outcome is reported once", ready.notice)
    }

    @Test fun aPendingSetAsideFoundAfterARestartIsReportedIncomplete() {
        store.lock = DemoStoreOpen.Locked(StoreLock.RECOVERY_PENDING, canSetAside = true)
        launch()
        assertEquals(DemoScreen.Locked(StoreLock.RECOVERY_PENDING, canReset = true, notice = DemoNotice.RESET_INCOMPLETE), last)
        assertFalse(showsGenericLockedBody(locked.notice))
    }

    @Test fun aNotStartedRetryOfAnUnfinishedSetAsideStaysIncomplete() {
        store.lock = DemoStoreOpen.Locked(StoreLock.DB_UNREADABLE, canSetAside = true)
        store.setAsideOutcome = SetAsideOutcome.INTERRUPTED
        val c = launch()
        c.reset()
        store.setAsideOutcome = SetAsideOutcome.NOT_STARTED // e.g. the Keystore is briefly unavailable
        c.reset()
        assertEquals(DemoNotice.RESET_INCOMPLETE, locked.notice)
        assertFalse(saidNothingChanged())
    }

    @Test fun resettingAgainAfterAnInterruptionCompletesTheResetAndSeedsOnce() {
        store.lock = DemoStoreOpen.Locked(StoreLock.DB_UNREADABLE, canSetAside = true)
        store.setAsideOutcome = SetAsideOutcome.INTERRUPTED
        val c = launch()
        c.reset()
        store.setAsideOutcome = SetAsideOutcome.DONE
        c.reset()
        assertEquals(DemoNotice.RESET_DONE, ready.notice)
        assertEquals(seedNames, names(ready))
        assertEquals(1, seedCasCount)
    }

    @Test fun aFailedPurgeFollowedByALockIsIncompleteNotNothingChanged() {
        val c = launch()
        store.purgeThrows = true
        store.lock = DemoStoreOpen.Locked(StoreLock.KEY_TRANSIENT, canSetAside = true)
        c.reset()
        assertEquals(DemoNotice.RESET_INCOMPLETE, locked.notice)
        assertFalse(saidNothingChanged())
    }

    /** Negative control: a purge I/O failure that left the list on disk says "Nothing was changed". */
    @Test fun aPurgeIoFailureThatKeptTheListSaysNothingChanged() {
        val c = launch()
        c.dispatch(DemoAction.Add("Eggs", Category.DAIRY))
        val saved = store.stored
        store.throwsIo = true
        store.purgeThrows = true
        c.reset()
        assertEquals(DemoNotice.RESET_FAILED, ready.notice)
        assertEquals(saved, store.stored)
        assertTrue("Eggs" in names(ready))
    }

    @Test fun ioFailuresOpeningReadingOrWritingFailClosedWithoutEscaping() {
        store.throwsIo = true
        store.openThrows = true
        val c = launch()
        assertEquals(DemoScreen.Locked(StoreLock.OPEN_ERROR, canReset = false), last)

        store.openThrows = false
        store.stored = LocalDemoList.seededOutbox(store.key)
        store.recoverThrows = true
        c.reload()
        assertEquals(StoreLock.STATE_UNREADABLE, locked.reason)
        assertTrue(store.casCalls.isEmpty())

        store.recoverThrows = false
        c.reload()
        store.casThrows = true
        c.dispatch(DemoAction.Add("Eggs", Category.DAIRY))
        assertTrue(last is DemoScreen.SaveFailed)
        assertEquals(LocalDemoList.seededOutbox(store.key), store.stored)
    }
}
