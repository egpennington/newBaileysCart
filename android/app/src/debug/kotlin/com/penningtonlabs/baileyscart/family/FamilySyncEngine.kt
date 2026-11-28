package com.penningtonlabs.baileyscart.family

import com.penningtonlabs.baileyscart.core.model.offline.AddOutcome
import com.penningtonlabs.baileyscart.core.model.offline.Category
import com.penningtonlabs.baileyscart.core.model.offline.Dispatch
import com.penningtonlabs.baileyscart.core.model.offline.FamilyEpoch
import com.penningtonlabs.baileyscart.core.model.offline.FamilyOutbox
import com.penningtonlabs.baileyscart.core.model.offline.FamilyOutboxRestore
import com.penningtonlabs.baileyscart.core.model.offline.ItemCommand
import com.penningtonlabs.baileyscart.core.model.offline.ItemId
import com.penningtonlabs.baileyscart.core.model.offline.ItemImage
import com.penningtonlabs.baileyscart.core.model.offline.ItemName
import com.penningtonlabs.baileyscart.core.model.offline.ListProjector
import com.penningtonlabs.baileyscart.core.model.offline.OpId
import com.penningtonlabs.baileyscart.core.model.offline.OpState
import com.penningtonlabs.baileyscart.core.model.offline.OutboxOperation
import com.penningtonlabs.baileyscart.core.model.offline.ProjectedItem
import com.penningtonlabs.baileyscart.core.model.offline.ProjectionResult
import com.penningtonlabs.baileyscart.core.model.offline.ServerErrorCode
import com.penningtonlabs.baileyscart.core.model.offline.ServerSnapshot
import com.penningtonlabs.baileyscart.core.model.offline.Transition
import java.util.concurrent.Executor
import java.util.concurrent.atomic.AtomicBoolean

/** What the family list header says about the connection. */
enum class Connection {
    /** Waiting for the first server-confirmed list since the app became visible. */
    CONNECTING,
    ONLINE,

    /** Showing the saved list; changes queue. */
    OFFLINE,

    /** A listener was refused and the server could not yet confirm access. Nothing is purged. */
    CHECKING_ACCESS,

    /** The ID token was refused; it is being refreshed. */
    SIGN_IN_REFRESH,

    /** Something else failed; retried when the app is next resumed. */
    ERROR,
}

data class FamilyView(
    val familyId: String,
    val items: List<ProjectedItem>,
    val connection: Connection,
    val lastSyncedAtMillis: Long?,
    val pending: Int,
    /** Changes the server refused (for example ITEM_DELETED), as "<item>: <code>". */
    val problems: List<String>,
    /** Set when the saved list could not be projected (fail closed: nothing is shown). */
    val unreadable: String? = null,
)

sealed interface EngineScreen {
    data object Opening : EngineScreen

    data class Ready(val view: FamilyView) : EngineScreen

    /** The encrypted store cannot be used. Nothing is deleted. */
    data class Locked(val reason: String) : EngineScreen

    /** Access was confirmed revoked: the local copy was purged and [unsent] changes were discarded. */
    data class Revoked(val unsent: Int, val outcome: PurgeOutcome) : EngineScreen
}

/**
 * BC-FAMILY-SYNC-01 Step 2: one signed-in user's view of one shared family list (debug source set
 * only; Sync Contract Rev 2 sections 2-5).
 *
 * Every task and every adapter callback runs on [serial] (one thread, in order), so all fields
 * below are confined to it.
 *
 * Invariants:
 *  - SQLCipher is the only persistent copy. Server-confirmed listener events (never from-cache
 *    ones) REPLACE the saved snapshot, so a deletion missed while offline cannot survive.
 *  - Local changes go through the S2a outbox and are committed (compare-and-set) before they are
 *    rendered or sent. One operation in flight at a time, in sequence order, with its own opId,
 *    epoch and payload on every retry.
 *  - Nothing is sent until `account.getSession` has confirmed access since the app last became
 *    visible or lost the network. A confirmed loss of access purges the local copy and sends
 *    nothing; an unreachable server or a network error is never treated as revocation.
 *  - Listeners are attached only while visible ([onVisible]) and detached, with the Firestore
 *    network disabled, when hidden ([onHidden]). Retries use bounded backoff and run only while visible.
 *  - Old-epoch operations are quarantined or rejected, never re-tagged.
 */
class FamilySyncEngine(
    private val uid: String,
    private val familyId: String,
    private val epochHint: Long?,
    private val stores: FamilyStoreFactory,
    private val backend: FamilyBackend,
    private val hub: ListHub,
    private val serial: Executor,
    private val scheduler: RetryScheduler,
    private val clock: () -> Long,
    private val publish: (EngineScreen) -> Unit,
    private val trace: (String) -> Unit = {},
) {
    private val closed = AtomicBoolean(false)

    private var session: FamilyStoreSession? = null
    private var outbox: FamilyOutbox? = null
    private var snapshot: ServerSnapshot? = null
    private var visible = false
    private var attachment: ListHub.Attachment? = null
    private var attachGeneration = 0
    private var verified = false
    private var verifying = false
    private var inFlight = false
    private var revoked = false

    /** Set by a PERMISSION_DENIED listener error; the listener is re-attached only on the next resume. */
    private var deniedSinceResume = false
    private var connection = Connection.CONNECTING
    private var lastSynced: Long? = null
    private var cancelRetry: (() -> Unit)? = null
    private var retryDelay = INITIAL_BACKOFF_MS
    private var problem: String? = null

    val isClosed: Boolean get() = closed.get()

    fun start() = submit { open() }

    /** Activity onStart. */
    fun onVisible() = submit {
        visible = true
        deniedSinceResume = false
        verified = false
        if (revoked || session == null) return@submit
        hub.setNetworkEnabled(true)
        trace("op=NETWORK enabled=true")
        if (connection != Connection.CHECKING_ACCESS) connection = Connection.CONNECTING
        attach()
        render()
        checkSession(SessionReason.RESUME)
    }

    /** Activity onStop: no listener, no network, no retry timer while hidden. */
    fun onHidden() = submit {
        visible = false
        verified = false
        detach()
        stopRetry()
        hub.setNetworkEnabled(false)
        trace("op=NETWORK enabled=false")
        if (!revoked && session != null) {
            connection = Connection.OFFLINE
            render()
        }
    }

    fun onNetworkAvailable() = submit {
        if (!visible || revoked) return@submit
        trace("op=NETWORK_CALLBACK available=true")
        checkSession(SessionReason.RECONNECT)
    }

    fun onNetworkLost() = submit {
        trace("op=NETWORK_CALLBACK available=false")
        verified = false
        if (!revoked && session != null) {
            connection = Connection.OFFLINE
            render()
        }
    }

    fun add(name: ItemName) = submit {
        mutate { ob -> ob.enqueue(OpId.random(), ob.key, ob.currentEpoch, ItemCommand.Add(ItemId.random(), name, Category.MISC)) }
    }

    /** An explicit value, never a toggle (Rev 2 section 4). */
    fun setChecked(itemId: ItemId, checked: Boolean) = submit {
        // The image only labels a later rejection (for example ITEM_DELETED) once the item is gone.
        val image = currentItems().firstOrNull { it.itemId == itemId }?.let { ItemImage(it.itemId, it.name, it.category) }
        mutate { ob -> ob.enqueue(OpId.random(), ob.key, ob.currentEpoch, ItemCommand.Edit(itemId, null, null, checked), image) }
    }

    fun delete(itemId: ItemId) = submit {
        val shown = currentItems().firstOrNull { it.itemId == itemId }
        val image = shown?.let { ItemImage(it.itemId, it.name, it.category) }
        mutate { ob -> ob.enqueue(OpId.random(), ob.key, ob.currentEpoch, ItemCommand.Delete(itemId), image) }
    }

    /** Final. The store is closed on the serial thread; no later task or callback does anything. */
    fun close() {
        if (!closed.compareAndSet(false, true)) return
        serial.execute {
            detach()
            stopRetry()
            closeSession()
        }
    }

    // ---- serial thread only ------------------------------------------------------------------

    private fun submit(task: () -> Unit) {
        if (closed.get()) return
        serial.execute { if (!closed.get()) task() }
    }

    /** Adapter callbacks are already on [serial]; a closed engine ignores them. */
    private inline fun guarded(block: () -> Unit) {
        if (!closed.get()) block()
    }

    private fun emit(screen: EngineScreen) {
        if (!closed.get()) publish(screen)
    }

    private fun open() {
        emit(EngineScreen.Opening)
        val opened = try {
            stores.open(uid, familyId)
        } catch (_: Exception) {
            StoreOpen.Locked("OPEN_ERROR")
        }
        when (opened) {
            is StoreOpen.Locked -> emit(EngineScreen.Locked(opened.reason))
            is StoreOpen.Opened -> {
                val s = opened.session
                session = s
                val loaded = try {
                    val recovered = s.recover()
                    val ob = recovered ?: FamilyOutbox.empty(s.key, FamilyEpoch.of(epochHint ?: 1) ?: FamilyEpoch.INITIAL).also {
                        check(s.compareAndSet(null, it)) { "new family scope was not stored" }
                    }
                    ob to s.readSnapshot()
                } catch (_: Exception) {
                    null
                }
                if (loaded == null) {
                    closeSession()
                    emit(EngineScreen.Locked("STATE_UNREADABLE"))
                    return
                }
                outbox = loaded.first
                snapshot = loaded.second
                trace("op=OPEN pending=${loaded.first.operations.count { it.state.isActive }} cached=${loaded.second?.items?.size ?: -1}")
                val hint = epochHint?.let(FamilyEpoch::of)
                if (hint != null && hint > loaded.first.currentEpoch) applyTransition(loaded.first.advanceEpoch(hint))
                render()
            }
        }
    }

    private fun closeSession() {
        val s = session ?: return
        session = null
        runCatching { s.close() }
    }

    // ---- listeners ---------------------------------------------------------------------------

    private fun attach() {
        if (attachment != null || revoked || !visible || deniedSinceResume) return
        val generation = ++attachGeneration
        trace("op=LISTENER_ATTACH")
        attachment = hub.attach(familyId) { event -> guarded { if (generation == attachGeneration) onListEvent(event) } }
    }

    private fun detach() {
        val a = attachment ?: return
        attachment = null
        attachGeneration++
        runCatching { a.detach() }
        trace("op=LISTENER_DETACH")
    }

    private fun onListEvent(event: ListEvent) {
        val ob = outbox ?: return
        val s = session ?: return
        when (event) {
            is ListEvent.Items -> {
                if (event.fromCache) {
                    // Not confirmed by the server: never replaces the saved list.
                    if (connection == Connection.ONLINE || connection == Connection.CONNECTING) connection = Connection.OFFLINE
                    verified = false
                    render()
                    return
                }
                val next = ServerSnapshot(s.key, ob.currentEpoch, event.items)
                try {
                    s.replaceSnapshot(next)
                } catch (_: Exception) {
                    problem = "The saved copy could not be updated."
                }
                snapshot = next
                lastSynced = clock()
                if (connection != Connection.CHECKING_ACCESS) connection = Connection.ONLINE
                trace("op=SNAPSHOT items=${event.items.size}")
                render()
                if (!verified) checkSession(SessionReason.RECONNECT) else flush()
            }
            is ListEvent.Meta -> {
                val epoch = event.familyEpoch?.let(FamilyEpoch::of) ?: return
                if (event.fromCache || epoch <= ob.currentEpoch) return
                trace("op=EPOCH_ADVANCE")
                applyTransition(ob.advanceEpoch(epoch))
                snapshot = snapshot?.copy(epoch = epoch)
                render()
            }
            is ListEvent.Failed -> onListenFailed(event.error)
        }
    }

    private fun onListenFailed(error: ListenError) {
        trace("op=LISTENER_ERROR code=$error")
        detach()
        verified = false
        when (error) {
            ListenError.PERMISSION_DENIED -> {
                deniedSinceResume = true
                connection = Connection.CHECKING_ACCESS
                render()
                checkSession(SessionReason.DENIED)
            }
            ListenError.UNAUTHENTICATED -> {
                connection = Connection.SIGN_IN_REFRESH
                render()
                backend.refreshToken { ok -> guarded { if (ok && visible) { connection = Connection.CONNECTING; attach(); render() } } }
            }
            ListenError.UNAVAILABLE -> {
                // Never revocation. Re-attach after backoff.
                connection = Connection.OFFLINE
                render()
                scheduleRetry()
            }
            ListenError.OTHER -> {
                connection = Connection.ERROR
                render()
            }
        }
    }

    // ---- session verification and revocation -------------------------------------------------

    private enum class SessionReason { RESUME, RECONNECT, DENIED, REJECTED }

    /** Rev 2 section 2: `account.getSession` before anything is sent, and after a refusal. */
    private fun checkSession(reason: SessionReason) {
        if (revoked || session == null || verifying) return
        if (verified && reason != SessionReason.DENIED && reason != SessionReason.REJECTED) {
            flush()
            return
        }
        verifying = true
        trace("op=SESSION_CHECK phase=begin reason=$reason")
        backend.getSession { result ->
            guarded {
                verifying = false
                when (result) {
                    is CallResult.Ok -> {
                        val family = result.value.firstOrNull { it.familyId == familyId }
                        if (family == null || family.accessMode == "NONE") {
                            trace("op=SESSION_CHECK phase=end result=NO_ACCESS")
                            revokeAndPurge()
                            return@guarded
                        }
                        trace("op=SESSION_CHECK phase=end result=MEMBER")
                        verified = true
                        retryDelay = INITIAL_BACKOFF_MS
                        if (reason == SessionReason.DENIED || deniedSinceResume) {
                            // Still a member, yet the read was refused: show it; retried on the next resume.
                            connection = Connection.ERROR
                            render()
                            return@guarded
                        }
                        if (reason == SessionReason.REJECTED) {
                            // The server refused a change but still reports membership: back off, never spin.
                            verified = false
                            render()
                            scheduleRetry()
                            return@guarded
                        }
                        if (connection == Connection.CHECKING_ACCESS || connection == Connection.SIGN_IN_REFRESH) {
                            connection = Connection.CONNECTING
                        }
                        attach()
                        render()
                        flush()
                    }
                    CallResult.Unauthenticated -> {
                        trace("op=SESSION_CHECK phase=end result=UNAUTHENTICATED")
                        if (connection != Connection.CHECKING_ACCESS) connection = Connection.SIGN_IN_REFRESH
                        render()
                        backend.refreshToken { ok -> guarded { if (ok && visible) checkSession(reason) } }
                    }
                    is CallResult.Rejected, CallResult.Unreachable -> {
                        // No decision about membership: purge nothing, send nothing.
                        trace("op=SESSION_CHECK phase=end result=UNDECIDED")
                        if (connection != Connection.CHECKING_ACCESS) connection = Connection.OFFLINE
                        render()
                        scheduleRetry()
                    }
                }
            }
        }
    }

    private fun revokeAndPurge() {
        revoked = true
        detach()
        stopRetry()
        val unsent = outbox?.operations?.count { it.state.isActive } ?: 0
        closeSession()
        outbox = null
        snapshot = null
        val outcome = try {
            stores.purge(uid, familyId)
        } catch (_: Exception) {
            PurgeOutcome.FAILED
        }
        trace("op=PURGE unsent=$unsent outcome=$outcome")
        emit(EngineScreen.Revoked(unsent, outcome))
    }

    // ---- local changes and sending ------------------------------------------------------------

    private fun mutate(change: (FamilyOutbox) -> Transition) {
        if (revoked) return
        val ob = outbox ?: return
        when (val t = change(ob)) {
            is Transition.Applied -> if (persist(ob, t.outbox)) {
                render()
                flush()
            }
            is Transition.Unchanged -> Unit
            is Transition.Refused -> {
                problem = "That change was refused locally (${t.reason})."
                render()
            }
        }
    }

    /** Compare-and-set, then adopt. A failed write keeps the previous committed state. */
    private fun persist(expected: FamilyOutbox, updated: FamilyOutbox): Boolean {
        if (expected == updated) return true
        val s = session ?: return false
        val ok = try {
            s.compareAndSet(expected, updated)
        } catch (_: Exception) {
            false
        }
        if (ok) outbox = updated else problem = "A change could not be saved on this device."
        return ok
    }

    private fun applyTransition(t: Transition) {
        val ob = outbox ?: return
        if (t is Transition.Applied) persist(ob, t.outbox)
    }

    private fun flush() {
        if (!visible || !verified || inFlight || revoked) return
        val ob = outbox ?: return
        when (val d = ob.dispatchNext()) {
            is Dispatch.Idle -> persist(ob, d.outbox)
            is Dispatch.Send -> {
                if (!persist(ob, d.outbox)) return
                inFlight = true
                val op = d.operation
                trace("op=SEND phase=begin kind=${op.command::class.simpleName} attempt=${op.attempts}")
                backend.send(familyId, op) { result -> guarded { inFlight = false; onSent(op, result) } }
            }
        }
    }

    private fun onSent(op: OutboxOperation, result: CallResult<Long>) {
        val ob = outbox ?: return
        when (result) {
            is CallResult.Ok -> {
                trace("op=SEND phase=end result=COMMITTED")
                val outcome = if (op.command is ItemCommand.Add) AddOutcome.CREATED else null
                applyTransition(ob.recordCommitted(ob.key, op.opId, result.value, outcome))
                retryDelay = INITIAL_BACKOFF_MS
                render()
                flush()
            }
            is CallResult.Rejected -> {
                trace("op=SEND phase=end result=REJECTED code=${result.code}")
                when {
                    result.code in ACCESS_CODES -> {
                        // Keep the operation unsent and ask the server whether access really ended.
                        applyTransition(ob.recordAmbiguous(ob.key, op.opId))
                        verified = false
                        render()
                        checkSession(SessionReason.REJECTED)
                    }
                    result.retryable -> {
                        applyTransition(ob.recordAmbiguous(ob.key, op.opId))
                        render()
                        scheduleRetry()
                    }
                    else -> {
                        applyTransition(ob.recordRejected(ob.key, op.opId, ServerErrorCode(result.code)))
                        render()
                        flush()
                    }
                }
            }
            CallResult.Unauthenticated -> {
                trace("op=SEND phase=end result=UNAUTHENTICATED")
                applyTransition(ob.recordAmbiguous(ob.key, op.opId))
                render()
                backend.refreshToken { ok -> guarded { if (ok) flush() else scheduleRetry() } }
            }
            CallResult.Unreachable -> {
                trace("op=SEND phase=end result=UNREACHABLE")
                applyTransition(ob.recordAmbiguous(ob.key, op.opId))
                verified = false
                connection = Connection.OFFLINE
                render()
                scheduleRetry()
            }
        }
    }

    private fun scheduleRetry() {
        if (!visible || revoked) return
        stopRetry()
        val delay = retryDelay
        retryDelay = (retryDelay * 2).coerceAtMost(MAX_BACKOFF_MS)
        trace("op=RETRY_SCHEDULED delayMs=$delay")
        cancelRetry = scheduler.schedule(delay) {
            submit {
                cancelRetry = null
                if (!visible || revoked) return@submit
                attach()
                checkSession(SessionReason.RECONNECT)
            }
        }
    }

    private fun stopRetry() {
        cancelRetry?.invoke()
        cancelRetry = null
    }

    // ---- rendering ---------------------------------------------------------------------------

    private fun currentItems(): List<ProjectedItem> {
        val ob = outbox ?: return emptyList()
        val snap = (snapshot ?: ServerSnapshot(ob.key, ob.currentEpoch, emptyList())).copy(epoch = ob.currentEpoch)
        return (ListProjector.project(snap, renderable(ob)) as? ProjectionResult.Projected)?.projection?.items ?: emptyList()
    }

    /**
     * The outbox as rendered: without COMMITTED operations. The read model holds live items only
     * (Rev 2 section 1), so the S2a rule "a committed overlay stays until the snapshot shows its
     * version" never retires an add or edit whose item was deleted afterwards, by anyone: the item
     * would be resurrected on screen. An acknowledged operation is server truth, so the server list
     * alone decides. Cost: a brief flicker if the ack arrives before the listener event. Rendering
     * only; the stored outbox is unchanged.
     */
    private fun renderable(ob: FamilyOutbox): FamilyOutbox {
        if (ob.operations.none { it.state == OpState.COMMITTED }) return ob
        val kept = ob.operations.filter { it.state != OpState.COMMITTED }
        return (FamilyOutbox.restore(ob.key, ob.currentEpoch, ob.access, kept) as? FamilyOutboxRestore.Restored)?.outbox ?: ob
    }

    private fun render() {
        if (revoked) return
        val ob = outbox ?: return
        // The read model is not epoch-scoped; the saved copy is re-tagged to the current epoch for display.
        val snap = (snapshot ?: ServerSnapshot(ob.key, ob.currentEpoch, emptyList())).copy(epoch = ob.currentEpoch)
        val names = snap.items.associate { it.itemId to it.name }
        val problems = ob.attention.map { "${label(it, names)}: ${it.rejection?.code ?: it.state.name}" } + listOfNotNull(problem)
        val view = when (val p = ListProjector.project(snap, renderable(ob))) {
            is ProjectionResult.Projected -> FamilyView(familyId, p.projection.items, connection, lastSynced, pendingCount(ob), problems)
            is ProjectionResult.Refused -> FamilyView(familyId, emptyList(), connection, lastSynced, pendingCount(ob), problems, p.reason.name)
        }
        emit(EngineScreen.Ready(view))
    }

    private fun pendingCount(ob: FamilyOutbox): Int = ob.operations.count { it.state.isActive }

    private fun label(op: OutboxOperation, names: Map<ItemId, String>): String = when (val c = op.command) {
        is ItemCommand.Add -> c.name.display
        is ItemCommand.Edit -> c.name?.display ?: names[c.itemId] ?: op.preImage?.name ?: "An item"
        is ItemCommand.Delete -> op.preImage?.name ?: names[c.itemId] ?: "An item"
        is ItemCommand.UndoDelete -> names[c.itemId] ?: "An item"
    }

    companion object {
        const val INITIAL_BACKOFF_MS = 1_000L
        const val MAX_BACKOFF_MS = 30_000L

        /** Server answers that may mean access ended. Confirmed with account.getSession before any purge. */
        val ACCESS_CODES = setOf("MEMBERSHIP_REVOKED", "NOT_FOUND", "FORBIDDEN")
    }
}
