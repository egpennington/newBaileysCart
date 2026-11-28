package com.penningtonlabs.baileyscart.family

import com.penningtonlabs.baileyscart.core.model.offline.AccountKey
import com.penningtonlabs.baileyscart.core.model.offline.Category
import com.penningtonlabs.baileyscart.core.model.offline.FamilyEpoch
import com.penningtonlabs.baileyscart.core.model.offline.FamilyId
import com.penningtonlabs.baileyscart.core.model.offline.FamilyKey
import com.penningtonlabs.baileyscart.core.model.offline.FamilyOutbox
import com.penningtonlabs.baileyscart.core.model.offline.ItemCommand
import com.penningtonlabs.baileyscart.core.model.offline.ItemId
import com.penningtonlabs.baileyscart.core.model.offline.ItemName
import com.penningtonlabs.baileyscart.core.model.offline.NameValidation
import com.penningtonlabs.baileyscart.core.model.offline.OpState
import com.penningtonlabs.baileyscart.core.model.offline.OutboxOperation
import com.penningtonlabs.baileyscart.core.model.offline.ServerItem
import com.penningtonlabs.baileyscart.core.model.offline.ServerSnapshot
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * BC-FAMILY-SYNC-01 Step 2: JVM tests for the family sync engine (Sync Contract Rev 2 sections
 * 2-5). Every adapter is a fake that records calls and holds callbacks until the test completes
 * them, so ordering (session check before send, purge before anything is sent) is asserted exactly.
 */
class FamilySyncEngineTest {
    private val uid = "uidA"
    private val fid = "famA"

    private class Pending<T>(val done: (CallResult<T>) -> Unit)

    private class FakeBackend : FamilyBackend {
        val sessions = ArrayList<Pending<List<SessionFamily>>>()
        val sends = ArrayList<Pair<OutboxOperation, Pending<Long>>>()

        override fun getSession(done: (CallResult<List<SessionFamily>>) -> Unit) {
            sessions += Pending(done)
        }

        override fun createFamily(opId: String, done: (CallResult<FamilyRef>) -> Unit) = error("unused")

        override fun createInvite(opId: String, familyId: String, familyEpoch: Long, done: (CallResult<String>) -> Unit) = error("unused")

        override fun acceptInvite(opId: String, code: String, done: (CallResult<FamilyRef>) -> Unit) = error("unused")

        override fun send(familyId: String, op: OutboxOperation, done: (CallResult<Long>) -> Unit) {
            sends += op to Pending(done)
        }

        override fun refreshToken(done: (Boolean) -> Unit) = done(true)

        fun answerSession(result: CallResult<List<SessionFamily>>) = sessions.removeAt(0).done(result)
    }

    private class FakeHub : ListHub {
        var listener: ((ListEvent) -> Unit)? = null
        val log = ArrayList<String>()

        override fun attach(familyId: String, onEvent: (ListEvent) -> Unit): ListHub.Attachment {
            log += "attach"
            listener = onEvent
            return ListHub.Attachment {
                log += "detach"
                listener = null
            }
        }

        override fun setNetworkEnabled(enabled: Boolean) {
            log += "network=$enabled"
        }
    }

    private class FakeStores(private val account: String = "acct") : FamilyStoreFactory {
        var outbox: FamilyOutbox? = null
        var snapshot: ServerSnapshot? = null
        val events = ArrayList<String>()

        override fun open(uid: String, familyId: String): StoreOpen {
            events += "open"
            val key = FamilyKey(AccountKey.of(account)!!, FamilyId.of(familyId)!!)
            return StoreOpen.Opened(object : FamilyStoreSession {
                override val key = key

                override fun recover() = outbox

                override fun compareAndSet(expected: FamilyOutbox?, updated: FamilyOutbox): Boolean {
                    if (outbox != expected) return false
                    outbox = updated
                    return true
                }

                override fun readSnapshot() = snapshot

                override fun replaceSnapshot(snapshot: ServerSnapshot) {
                    this@FakeStores.snapshot = snapshot
                }

                override fun close() {
                    events += "close"
                }
            })
        }

        override fun purge(uid: String, familyId: String): PurgeOutcome {
            events += "purge"
            outbox = null
            snapshot = null
            return PurgeOutcome.DONE
        }
    }

    private class ManualScheduler : RetryScheduler {
        val tasks = ArrayList<Pair<Long, () -> Unit>>()
        var cancelled = 0

        override fun schedule(delayMillis: Long, task: () -> Unit): () -> Unit {
            val entry = delayMillis to task
            tasks += entry
            return {
                if (tasks.remove(entry)) cancelled++
            }
        }

        fun runAll() {
            val now = tasks.toList()
            tasks.clear()
            now.forEach { it.second() }
        }
    }

    private val backend = FakeBackend()
    private val hub = FakeHub()
    private val stores = FakeStores()
    private val scheduler = ManualScheduler()
    private val screens = ArrayList<EngineScreen>()

    private fun engine(epochHint: Long? = 1) = FamilySyncEngine(
        uid = uid, familyId = fid, epochHint = epochHint, stores = stores, backend = backend, hub = hub,
        serial = { it.run() }, scheduler = scheduler, clock = { 1_000L }, publish = { screens += it },
    ).also { it.start() }

    private fun name(raw: String): ItemName = (ItemName.validate(raw) as NameValidation.Valid).name

    private val member = CallResult.Ok(listOf(SessionFamily(fid, "MEMBER", "READ_WRITE")))

    private fun view(): FamilyView = (screens.last() as EngineScreen.Ready).view

    private fun item(id: ItemId, n: String, rev: Long, checked: Boolean = false) = ServerItem(id, n, Category.MISC, rev, checked = checked)

    @Test
    fun nothingIsSentUntilTheSessionCheckConfirmsMembership() {
        val e = engine()
        e.onVisible()
        e.add(name("Milk"))
        assertEquals("a change must wait for account.getSession", 0, backend.sends.size)
        backend.answerSession(member)
        assertEquals(1, backend.sends.size)
        val (op, pending) = backend.sends.removeAt(0)
        assertTrue(op.command is ItemCommand.Add)
        assertEquals("pending until acknowledged", listOf("Milk"), view().items.map { it.name })
        pending.done(CallResult.Ok(1))
        assertEquals(OpState.COMMITTED, stores.outbox!!.operation(op.opId)!!.state)
        hub.listener!!(ListEvent.Items(listOf(item(op.command.itemId, "Milk", 1)), fromCache = false))
        assertEquals(listOf("Milk"), view().items.map { it.name })
    }

    @Test
    fun confirmedRevocationOnReconnectPurgesAndSendsNothing() {
        val e = engine()
        e.onVisible()
        backend.answerSession(CallResult.Unreachable) // offline at resume: undecided, nothing purged
        e.add(name("Bread"))
        e.add(name("Eggs"))
        assertEquals(0, backend.sends.size)
        assertFalse(stores.events.contains("purge"))
        e.onNetworkAvailable()
        backend.answerSession(CallResult.Ok(emptyList())) // the server no longer lists this family
        assertEquals("no queued change may be sent after revocation", 0, backend.sends.size)
        assertEquals(listOf("open", "close", "purge"), stores.events)
        val revoked = screens.last() as EngineScreen.Revoked
        assertEquals(2, revoked.unsent)
        assertEquals("the listener is detached by the purge", "detach", hub.log.last())
        assertNull(hub.listener)
    }

    @Test
    fun accessModeNoneCountsAsRevoked() {
        val e = engine()
        e.onVisible()
        backend.answerSession(CallResult.Ok(listOf(SessionFamily(fid, "MEMBER", "NONE"))))
        assertTrue(screens.last() is EngineScreen.Revoked)
        assertTrue(stores.events.contains("purge"))
    }

    @Test
    fun permissionDeniedWithUnreachableSessionNeverPurges() {
        val e = engine()
        e.onVisible()
        backend.answerSession(member)
        hub.listener!!(ListEvent.Failed(ListenError.PERMISSION_DENIED))
        assertNull("the refused listener is detached", hub.listener)
        backend.answerSession(CallResult.Unreachable)
        assertFalse(stores.events.contains("purge"))
        assertEquals(Connection.CHECKING_ACCESS, view().connection)
        // Retry while visible: the server now confirms the loss of access.
        scheduler.runAll()
        backend.answerSession(CallResult.Ok(emptyList()))
        assertTrue(stores.events.contains("purge"))
    }

    @Test
    fun unavailableIsNeverRevocation() {
        val e = engine()
        e.onVisible()
        backend.answerSession(member)
        hub.listener!!(ListEvent.Failed(ListenError.UNAVAILABLE))
        assertTrue(backend.sessions.isEmpty())
        assertFalse(stores.events.contains("purge"))
        assertEquals(Connection.OFFLINE, view().connection)
    }

    @Test
    fun fromCacheEventsNeverReplaceTheSavedListButServerEventsDo() {
        val milk = ItemId.random()
        stores.outbox = FamilyOutbox.empty(FamilyKey(AccountKey.of("acct")!!, FamilyId.of(fid)!!), FamilyEpoch.INITIAL)
        stores.snapshot = ServerSnapshot(stores.outbox!!.key, FamilyEpoch.INITIAL, listOf(item(milk, "Milk", 1)))
        val e = engine()
        assertEquals(listOf("Milk"), view().items.map { it.name })
        e.onVisible()
        hub.listener!!(ListEvent.Items(emptyList(), fromCache = true))
        assertEquals("a from-cache event is not server truth", listOf("Milk"), view().items.map { it.name })
        assertEquals(1, stores.snapshot!!.items.size)
        hub.listener!!(ListEvent.Items(emptyList(), fromCache = false))
        assertEquals("a deletion missed while offline must not survive", emptyList<String>(), view().items.map { it.name })
        assertEquals(0, stores.snapshot!!.items.size)
    }

    @Test
    fun hiddenMeansNoListenerNoNetworkNoRetryAndNoSend() {
        val e = engine()
        e.onVisible()
        backend.answerSession(member)
        e.add(name("Milk"))
        backend.sends.removeAt(0).second.done(CallResult.Unreachable)
        assertEquals(1, scheduler.tasks.size)
        e.onHidden()
        assertNull(hub.listener)
        assertEquals("network=false", hub.log.last())
        assertTrue("the retry timer is cancelled", scheduler.tasks.isEmpty())
        e.onNetworkAvailable()
        e.add(name("Eggs"))
        assertEquals("nothing is sent while hidden", 0, backend.sends.size)
        assertTrue(backend.sessions.isEmpty())
        e.onVisible()
        assertEquals(listOf("network=true", "attach"), hub.log.takeLast(2))
        backend.answerSession(member)
        val retried = backend.sends.removeAt(0).first
        assertEquals("the same operation is retried, never re-created", 2, retried.attempts)
    }

    @Test
    fun checkOffSendsAnExplicitValue() {
        val milk = ItemId.random()
        val e = engine()
        e.onVisible()
        backend.answerSession(member)
        hub.listener!!(ListEvent.Items(listOf(item(milk, "Milk", 1)), fromCache = false))
        e.setChecked(milk, true)
        val edit = backend.sends.single().first.command as ItemCommand.Edit
        assertEquals(true, edit.checked)
        assertNull(edit.name)
        assertNull(edit.category)
        assertTrue("the pending check shows at once", view().items.single().checked)
    }

    @Test
    fun itemDeletedRejectionIsShownAndTheItemIsNotResurrected() {
        val milk = ItemId.random()
        val e = engine()
        e.onVisible()
        backend.answerSession(member)
        hub.listener!!(ListEvent.Items(listOf(item(milk, "Milk", 1)), fromCache = false))
        e.setChecked(milk, true)
        hub.listener!!(ListEvent.Items(emptyList(), fromCache = false)) // deleted by someone else
        backend.sends.removeAt(0).second.done(CallResult.Rejected("ITEM_DELETED", retryable = false))
        assertEquals(emptyList<String>(), view().items.map { it.name })
        assertEquals(listOf("Milk: ITEM_DELETED"), view().problems)
    }

    @Test
    fun aNewerEpochQuarantinesOldOperationsWhichAreNeverSent() {
        val e = engine()
        e.onVisible()
        backend.answerSession(CallResult.Unreachable)
        e.add(name("Milk"))
        hub.listener!!(ListEvent.Meta(2, fromCache = false))
        e.onNetworkAvailable()
        backend.answerSession(member)
        assertEquals(0, backend.sends.size)
        assertEquals(OpState.QUARANTINED_STALE_EPOCH, stores.outbox!!.operations.single().state)
        assertEquals(FamilyEpoch.of(2), stores.outbox!!.currentEpoch)
    }

    @Test
    fun accessRejectionIsConfirmedBeforeAnyPurge() {
        val e = engine()
        e.onVisible()
        backend.answerSession(member)
        e.add(name("Milk"))
        backend.sends.removeAt(0).second.done(CallResult.Rejected("MEMBERSHIP_REVOKED", retryable = false))
        assertFalse("a rejection alone is not a purge", stores.events.contains("purge"))
        assertEquals(OpState.RETRY_WAIT, stores.outbox!!.operations.single().state)
        backend.answerSession(CallResult.Ok(emptyList()))
        assertTrue(stores.events.contains("purge"))
    }

    @Test
    fun anItemDeletedAfterItsAddWasAcknowledgedIsNotResurrected() {
        val e = engine()
        e.onVisible()
        backend.answerSession(member)
        e.add(name("Bread"))
        val (op, pending) = backend.sends.removeAt(0)
        pending.done(CallResult.Ok(1))
        val bread = op.command.itemId
        hub.listener!!(ListEvent.Items(listOf(item(bread, "Bread", 1)), fromCache = false))
        assertEquals(listOf("Bread"), view().items.map { it.name })
        // Another member deletes it: the live-only read model simply no longer lists it.
        hub.listener!!(ListEvent.Items(emptyList(), fromCache = false))
        assertEquals("a committed add must not keep a deleted item on screen", emptyList<String>(), view().items.map { it.name })
    }

    @Test
    fun aClosedEngineIgnoresLateCallbacks() {
        val e = engine()
        e.onVisible()
        e.close()
        val before = screens.size
        backend.answerSession(CallResult.Ok(emptyList()))
        assertEquals(before, screens.size)
        assertFalse(stores.events.contains("purge"))
    }
}
