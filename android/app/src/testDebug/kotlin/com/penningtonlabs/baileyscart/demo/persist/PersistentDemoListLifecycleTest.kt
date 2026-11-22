package com.penningtonlabs.baileyscart.demo.persist

import com.penningtonlabs.baileyscart.core.model.offline.Category
import com.penningtonlabs.baileyscart.demo.DemoAction
import com.penningtonlabs.baileyscart.demo.SeqIds
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Collections
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executor
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * BC-S2-LOCAL-PERSIST LP-3a D1: one session at a time across ViewModel instances, in either order
 * Android creates and clears them, and nothing written, reset or published once an instance is
 * closed. Deterministic (queued executors) except [realThreadsNeverOverlapSessionsOrLeaveTheSerialThread].
 */
class PersistentDemoListLifecycleTest {
    private val store = FakeDemoStore()

    /** Holds tasks until [runAll]: the shared persistence thread, or the main thread. */
    private class QueueExecutor : Executor {
        val tasks = ArrayDeque<Runnable>()
        override fun execute(command: Runnable) {
            tasks.addLast(command)
        }

        fun runAll() {
            while (tasks.isNotEmpty()) tasks.removeFirst().run()
        }
    }

    private val serial = QueueExecutor()
    private val main = QueueExecutor()
    private val owner = DemoSessionOwner()

    /** One ViewModel's view of the list: what reached its screen on the main thread. */
    private inner class Vm(seed: Long) {
        val shown = mutableListOf<DemoScreen>()
        val list = PersistentDemoList(store, serial, { shown += it }, SeqIds(seed), owner, main)
        val ready get() = shown.last() as DemoScreen.Ready
        fun names() = ready.list.items.map { it.name }
    }

    private fun drain() {
        while (serial.tasks.isNotEmpty() || main.tasks.isNotEmpty()) {
            serial.runAll()
            main.runAll()
        }
    }

    private fun appliedWrites() = store.casCalls.count { it.applied }

    // ---- one session at a time ----------------------------------------------------------------

    @Test fun aNewInstanceCreatedBeforeTheOldOneIsClearedClosesTheOldSessionBeforeOpening() {
        val old = Vm(0).also { it.list.start() }
        drain()
        old.list.dispatch(DemoAction.Add("Eggs", Category.DAIRY))
        drain() // committed and shown: a confirmed write
        assertTrue("Eggs" in old.names())
        // Android order seen on device: the next Activity's ViewModel starts before onCleared.
        val next = Vm(1000).also { it.list.start() }
        old.list.close()
        drain()
        assertEquals(1, store.maxOpenSessions)
        assertEquals(1, store.openSessions)
        assertEquals(1, store.closes) // the old session, closed by the takeover, once
        assertTrue("the confirmed write survives the handover", "Eggs" in next.names())
        assertTrue(old.list.isClosed)
        assertFalse(next.list.isClosed)
    }

    @Test fun aNewInstanceStartedAfterTheOldOneClosedOpensOnceAndRecoversTheCommittedList() {
        val old = Vm(0).also { it.list.start() }
        drain()
        old.list.dispatch(DemoAction.Add("Eggs", Category.DAIRY))
        drain()
        old.list.close()
        val next = Vm(1000).also { it.list.start() }
        drain()
        assertEquals(1, store.maxOpenSessions)
        assertEquals(2, store.opens)
        assertTrue("Eggs" in next.names())
        assertEquals(1, store.casCalls.count { it.expected == null }) // seeded once, never again
    }

    @Test fun anOldInstanceRetiredMidQueueWritesNothingAfterTheNewSessionOpened() {
        val old = Vm(0).also { it.list.start() }
        drain()
        val before = appliedWrites()
        val next = Vm(1000).also { it.list.start() }
        old.list.dispatch(DemoAction.Add("Late", Category.MISC)) // queued after the takeover
        old.list.reset()
        drain()
        assertEquals(before, appliedWrites())
        assertEquals(0, store.purges)
        assertEquals(1, store.maxOpenSessions)
        assertFalse("Late" in next.names())
    }

    @Test fun actionsAlternatingBetweenTwoInstancesNeverOverlapSessions() {
        var current = Vm(0).also { it.list.start() }
        repeat(20) { i ->
            current.list.dispatch(DemoAction.Add("Item $i", Category.MISC))
            drain()
            val next = Vm(1000L * (i + 1)).also { it.list.start() }
            if (i % 2 == 0) current.list.close() // sometimes cleared before the next one runs
            drain()
            if (i % 2 == 1) current.list.close() // sometimes only after
            drain()
            assertTrue("Item $i" in next.names())
            current = next
        }
        assertEquals(1, store.maxOpenSessions)
        assertEquals(1, store.openSessions)
        assertEquals(21, store.opens)
        assertEquals(20, store.closes)
    }

    @Test fun aLockedStoreIsNotSetAsideByARetiredInstance() {
        store.lock = DemoStoreOpen.Locked(StoreLock.UNWRAP_FAILED, canSetAside = true)
        val old = Vm(0).also { it.list.start() }
        drain()
        assertTrue(old.shown.last() is DemoScreen.Locked)
        Vm(1000).list.start()
        old.list.reset() // confirmed on the old screen, but the old instance is already retired
        drain()
        assertEquals(0, store.setAsides)
    }

    @Test fun instancesSharingAnOwnerMustShareOneSerialExecutor() {
        val a = PersistentDemoList(store, Executor { it.run() }, { }, SeqIds(), owner)
        a.start()
        val b = PersistentDemoList(store, Executor { it.run() }, { }, SeqIds(1000), owner)
        val failure = runCatching { b.start() }.exceptionOrNull()
        assertTrue(failure is IllegalStateException)
        assertEquals(1, store.opens)
    }

    // ---- closed is final ----------------------------------------------------------------------

    @Test fun afterCloseNothingIsOpenedWrittenPurgedSetAsideOrPublished() {
        val vm = Vm(0).also { it.list.start() }
        drain()
        val shownBefore = vm.shown.size
        val writes = store.casCalls.size
        vm.list.close()
        vm.list.dispatch(DemoAction.Add("After close", Category.MISC))
        vm.list.reset()
        vm.list.reload()
        vm.list.start()
        drain()
        assertEquals(writes, store.casCalls.size)
        assertEquals(1, store.opens)
        assertEquals(0, store.purges)
        assertEquals(0, store.setAsides)
        assertEquals(0, store.openSessions)
        assertEquals(shownBefore, vm.shown.size)
    }

    @Test fun actionsQueuedBeforeCloseAreDroppedNotCommitted() {
        val vm = Vm(0).also { it.list.start() }
        drain()
        val writes = store.casCalls.size
        vm.list.dispatch(DemoAction.Add("Unconfirmed", Category.MISC)) // never shown
        vm.list.reset()
        vm.list.close()
        drain()
        assertEquals(writes, store.casCalls.size)
        assertEquals(0, store.purges)
        assertEquals(0, store.openSessions)
    }

    @Test fun aScreenPostedToTheMainThreadBeforeCloseIsNotShownAfterIt() {
        val vm = Vm(0).also { it.list.start() }
        serial.runAll() // the opened list is committed and posted, not yet delivered
        assertTrue(main.tasks.isNotEmpty())
        vm.list.close() // onCleared runs on the main thread before the posted screen
        drain()
        assertTrue(vm.shown.isEmpty())
    }

    @Test fun aRetiredInstancePublishesNothingMoreEvenForScreensAlreadyPosted() {
        val old = Vm(0).also { it.list.start() }
        drain()
        old.list.dispatch(DemoAction.Add("Eggs", Category.DAIRY))
        serial.runAll() // committed; the Ready is posted but not delivered
        val shownBefore = old.shown.size
        val next = Vm(1000).also { it.list.start() }
        serial.runAll() // takeover retires old
        main.runAll()
        assertEquals(shownBefore, old.shown.size)
        assertTrue("Eggs" in next.names())
    }

    @Test fun closeIsIdempotent() {
        val vm = Vm(0).also { it.list.start() }
        drain()
        vm.list.close()
        vm.list.close()
        drain()
        assertEquals(1, store.closes)
    }

    // ---- real threads --------------------------------------------------------------------------

    @Test fun realThreadsNeverOverlapSessionsOrLeaveTheSerialThread() {
        val persistence = Executors.newSingleThreadExecutor { r -> Thread(r, "test-persistence") }
        val ui = Executors.newSingleThreadExecutor { r -> Thread(r, "test-main") }
        val sharedOwner = DemoSessionOwner()
        val callers = Executors.newFixedThreadPool(4)
        val delivered = Collections.synchronizedList(mutableListOf<DemoScreen>())
        val lists = Collections.synchronizedList(mutableListOf<PersistentDemoList>())
        val done = CountDownLatch(200)
        repeat(200) { i ->
            callers.execute {
                val l = PersistentDemoList(store, persistence, { delivered += it }, SeqIds(10_000L * i), sharedOwner, ui)
                lists += l
                l.start()
                l.dispatch(DemoAction.Add("T$i", Category.MISC))
                if (i % 3 == 0) l.close()
                done.countDown()
            }
        }
        assertTrue(done.await(30, TimeUnit.SECONDS))
        callers.shutdown()
        assertTrue(callers.awaitTermination(30, TimeUnit.SECONDS))
        persistence.shutdown()
        assertTrue(persistence.awaitTermination(30, TimeUnit.SECONDS))
        ui.shutdown()
        assertTrue(ui.awaitTermination(30, TimeUnit.SECONDS))
        assertEquals(1, store.maxOpenSessions)
        assertEquals(setOf("test-persistence"), store.callThreads)
        assertTrue(store.openSessions <= 1)
        // Every shown Ready list is a committed state.
        val committed = store.casCalls.filter { it.applied }.map { it.updated }.toSet()
        delivered.filterIsInstance<DemoScreen.Ready>().forEach { assertTrue(it.list.outbox in committed) }
        // At most one instance is still open: the owner's current one.
        assertTrue(lists.count { !it.isClosed } <= 1)
    }

    // ---- trace -------------------------------------------------------------------------------

    @Test fun theTraceRecordsEveryStorageCallInOrderWithoutChangingResults() {
        val lines = mutableListOf<String>()
        val trace = DemoTrace { lines += it }
        val shown = mutableListOf<DemoScreen>()
        val list = PersistentDemoList(TracingDemoListStore(store, 7, trace), Executor { it.run() }, { shown += it }, SeqIds())
        list.start()
        list.dispatch(DemoAction.Add("Eggs", Category.DAIRY))
        list.close()
        val ops = lines.map { Regex("op=(\\S+) phase=(\\S+)").find(it)!!.destructured.let { (o, p) -> "$o:$p" } }
        assertEquals(
            listOf(
                "OPEN:begin", "OPEN:end", "RECOVER:begin", "RECOVER:end", "CAS:begin", "CAS:end", // seed
                "CAS:begin", "CAS:end", "CLOSE:begin", "CLOSE:end",
            ),
            ops,
        )
        assertTrue(lines.all { it.contains(" inst=7 ") })
        assertEquals((1..lines.size).map { "seq=$it" }, lines.map { it.substringBefore(' ') })
        assertTrue(lines[1].endsWith("result=OPENED"))
        assertTrue(lines[7].endsWith("result=true"))
        assertTrue("Eggs" in (shown.last() as DemoScreen.Ready).list.items.map { it.name })
        assertTrue("no list contents are traced", lines.none { "Eggs" in it })
    }

    @Test fun theTraceReportsLocksAndThrowsAndPassesThemThrough() {
        val lines = mutableListOf<String>()
        val traced = TracingDemoListStore(store, 3, DemoTrace { lines += it })
        store.lock = DemoStoreOpen.Locked(StoreLock.DB_UNREADABLE, canSetAside = true)
        assertEquals(store.lock, traced.open())
        store.setAsideThrows = true
        assertTrue(runCatching { traced.setAside() }.exceptionOrNull() is IllegalStateException)
        assertTrue(lines[1].endsWith("op=OPEN phase=end result=LOCKED:DB_UNREADABLE"))
        assertTrue(lines[3].endsWith("op=SETASIDE phase=end result=THREW"))
    }
}
