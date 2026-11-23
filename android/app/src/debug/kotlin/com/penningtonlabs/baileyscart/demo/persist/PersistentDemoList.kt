package com.penningtonlabs.baileyscart.demo.persist

import com.penningtonlabs.baileyscart.demo.DemoAction
import com.penningtonlabs.baileyscart.demo.DemoIds
import com.penningtonlabs.baileyscart.demo.DemoListState
import com.penningtonlabs.baileyscart.demo.LocalDemoList
import com.penningtonlabs.baileyscart.demo.RandomDemoIds
import java.util.concurrent.Executor
import java.util.concurrent.atomic.AtomicBoolean

/**
 * An outcome message shown with the next screen. After a confirmed reset, the message is decided
 * by what reopening the store finds on disk, not by which step reported an error.
 */
enum class DemoNotice {
    /** The confirmed reset completed: the previous list is gone and the starting sample list is saved. */
    RESET_DONE,

    /**
     * The reset changed nothing: the set-aside certainly never started, or the store reopened and
     * still holds the previous list. Never used when the outcome on disk is unknown.
     */
    RESET_FAILED,

    /**
     * A reset started and the store cannot be opened: the previous list is no longer usable (it
     * may have been removed, moved aside or still be unreadable) and no new list was started.
     */
    RESET_INCOMPLETE,
}

/** What the LOCAL DEMO screen shows. Only [Ready] is editable. */
sealed interface DemoScreen {
    /** Opening or recovering the store. Nothing is editable. */
    data object Opening : DemoScreen

    /** A confirmed reset is running. Nothing is editable. */
    data object Resetting : DemoScreen

    /** [list] is exactly the last durably committed state. */
    data class Ready(val list: DemoListState, val notice: DemoNotice? = null) : DemoScreen

    /**
     * The last change was not saved. [list] is the last committed state, shown read-only until the
     * user reloads from disk; the failed change is never shown.
     */
    data class SaveFailed(val list: DemoListState) : DemoScreen

    /** The store cannot be used. Nothing is deleted, seeded or recreated while it is locked. */
    data class Locked(val reason: StoreLock, val canReset: Boolean, val notice: DemoNotice? = null) : DemoScreen {
        /** LP-3c: the one way forward the locked screen offers besides Try again. */
        val recovery: LockedRecovery
            get() = when {
                reason.retryOnly -> LockedRecovery.RETRY_ONLY
                canReset -> LockedRecovery.RESET
                else -> LockedRecovery.CLEAR_STORAGE
            }
    }
}

/** LP-3c: what a locked screen suggests. */
enum class LockedRecovery {
    /** The user-confirmed reset (two steps; set-aside, never delete). */
    RESET,

    /** Try again, then restart the app or device. No reset and no clear-storage advice. */
    RETRY_ONLY,

    /** No in-app reset exists for this lock (TAG_KEY_MISSING): system settings is the only way. */
    CLEAR_STORAGE,
}

/**
 * BC-S2-LOCAL-PERSIST LP-2: the LOCAL DEMO list over durable encrypted storage.
 *
 * Every call is queued on [serial], which must run tasks one at a time in submission order (one
 * persistence thread). All fields below are confined to it, so actions are applied in exactly
 * the order the user made them.
 *
 * Invariants:
 *  - Seed once: the fixed fictional seed is written only when the store opened normally, holds
 *    no family scope at all, and the seed compare-and-set against "absent" succeeds.
 *  - Never seed, reset or recreate after a lock, a read failure, a projection refusal or any
 *    exception. An unreadable store is not an empty store.
 *  - Commit before render: a state that changes the outbox is published only after its
 *    compare-and-set returned true. A failed write publishes [DemoScreen.SaveFailed] with the
 *    previous committed state.
 *  - Reset only on [reset], which the UI calls after a two-step confirmation. A failed reset is
 *    never reported as done, and an unknown outcome is never reported as "nothing changed".
 *  - Storage exceptions of any kind (I/O and Keystore exceptions included) fail closed on this
 *    thread; none escapes a task.
 *  - LP-3c: a lock that may be temporary or has an unknown cause ([retryOnly]) is never
 *    resettable, whatever the store reports, so a passing failure cannot lead to a set-aside.
 *
 * LP-3a lifecycle and concurrency:
 *  - One session at a time: instances that share an [owner] (and its one [serial] executor) never
 *    hold the store open together. [start] first retires the owner's previous instance on the
 *    persistence thread, so the previous session is closed before the new one opens, whichever
 *    order Android creates and clears ViewModels in.
 *  - Closed is final: after [close] (or retirement by a newer instance) no queued or later task
 *    runs, so nothing is written, purged, reset or set aside, and nothing is published. A task
 *    already running when close is requested finishes (a transaction cannot be abandoned) but its
 *    screens are not published. Actions queued but not yet committed are dropped; they were never
 *    shown, so no confirmed change is lost.
 *  - Screens are handed to [deliver] (the main thread in the app). Delivery is checked again when
 *    it runs, so a screen queued before close is never shown after it.
 */
class PersistentDemoList(
    private val store: DemoListStore,
    private val serial: Executor,
    private val publish: (DemoScreen) -> Unit,
    private val ids: DemoIds = RandomDemoIds,
    private val owner: DemoSessionOwner = DemoSessionOwner(),
    private val deliver: Executor = Executor { it.run() },
) {
    /** Set once, from any thread. Read by every task and every delivery. */
    private val closed = AtomicBoolean(false)

    /** True once [close] was called or a newer instance took over. */
    val isClosed: Boolean get() = closed.get()

    private var session: DemoStoreSession? = null
    private var committed: DemoListState? = null
    private var screen: DemoScreen = DemoScreen.Opening

    /**
     * True from the moment a confirmed reset may have changed the stored demo data until a list is
     * shown again. While true, a Locked screen says [DemoNotice.RESET_INCOMPLETE] (also after
     * "Try again"), and a list that reopens says whether the reset completed or changed nothing.
     */
    private var resetUnresolved = false

    fun start() = submit {
        owner.takeOver(this, serial)
        openAndRecover()
    }

    /** "Try again" on a lock, or "Reload" after a failed save: re-read everything from disk. */
    fun reload() = submit {
        if (screen is DemoScreen.Locked || screen is DemoScreen.SaveFailed) {
            closeSession()
            openAndRecover()
        }
    }

    fun dispatch(action: DemoAction) = submit { mutate(action) }

    /** User-confirmed reset (the UI has already shown both confirmation steps). */
    fun reset() = submit { doReset() }

    /** Final. Later and still-queued tasks do nothing; the session is closed on the persistence thread. */
    fun close() {
        if (!closed.compareAndSet(false, true)) return
        serial.execute {
            owner.release(this)
            closeSession()
        }
    }

    private fun submit(task: () -> Unit) {
        if (closed.get()) return
        serial.execute { if (!closed.get()) task() }
    }

    // ---- persistence thread only -------------------------------------------------------------

    /** Called by [owner] on the persistence thread when a newer instance starts. */
    internal fun retire() {
        closed.set(true)
        closeSession()
    }

    private fun emit(next: DemoScreen) {
        screen = next
        if (closed.get()) return
        deliver.execute { if (!closed.get()) publish(next) }
    }

    private fun closeSession() {
        val s = session ?: return
        session = null
        committed = null
        runCatching { s.close() }
    }

    /**
     * A pending LP-1 recovery marker means a confirmed set-aside started and did not finish, so it
     * is reported as incomplete even after a process restart.
     */
    private fun lockedNotice(reason: StoreLock, otherwise: DemoNotice?): DemoNotice? =
        if (resetUnresolved || reason == StoreLock.RECOVERY_PENDING) DemoNotice.RESET_INCOMPLETE else otherwise

    private fun openAndRecover() {
        emit(DemoScreen.Opening)
        val opened = try {
            store.open()
        } catch (_: Exception) {
            DemoStoreOpen.Locked(StoreLock.OPEN_ERROR, canSetAside = false)
        }
        when (opened) {
            is DemoStoreOpen.Locked -> {
                val canReset = opened.canSetAside && !opened.reason.retryOnly
                emit(DemoScreen.Locked(opened.reason, canReset, lockedNotice(opened.reason, null)))
            }
            is DemoStoreOpen.Opened -> {
                session = opened.session
                val recovered = try {
                    recoverOrSeed(opened.session)
                } catch (_: Exception) {
                    null
                }
                if (recovered == null) {
                    closeSession()
                    val reason = StoreLock.STATE_UNREADABLE
                    emit(DemoScreen.Locked(reason, canReset = true, notice = lockedNotice(reason, null)))
                } else {
                    committed = recovered.state
                    // After a reset, disk decides: a newly seeded list proves the previous one is
                    // gone; a recovered list proves the reset changed nothing.
                    val notice = when {
                        !resetUnresolved -> null
                        recovered.seeded -> DemoNotice.RESET_DONE
                        else -> DemoNotice.RESET_FAILED
                    }
                    resetUnresolved = false
                    emit(DemoScreen.Ready(recovered.state, notice))
                }
            }
        }
    }

    private class Recovered(val state: DemoListState, val seeded: Boolean)

    /** Null = fail closed (never treated as empty). */
    private fun recoverOrSeed(s: DemoStoreSession): Recovered? {
        val stored = s.recover()
        if (stored != null) return LocalDemoList.fromOutbox(stored)?.let { Recovered(it, seeded = false) }
        // Positively new: no scope for any family, and the seed CAS against "absent" must win.
        if (s.hasAnyScope()) return null
        val seeded = LocalDemoList.seededOutbox(s.key)
        if (!s.compareAndSet(null, seeded)) return null
        return LocalDemoList.fromOutbox(seeded)?.let { Recovered(it, seeded = true) }
    }

    private fun mutate(action: DemoAction) {
        if (screen !is DemoScreen.Ready) return // not editable: Opening, Resetting, SaveFailed, Locked
        val s = session ?: return
        val current = committed ?: return
        val next = LocalDemoList.reduce(current, action, ids)
        if (next === current) return
        if (next.outbox == current.outbox) {
            // UI-only change (Undo slot expiry): nothing to persist.
            committed = next
            emit(DemoScreen.Ready(next))
            return
        }
        val saved = try {
            s.compareAndSet(current.outbox, next.outbox)
        } catch (_: Exception) {
            false
        }
        if (saved) {
            committed = next
            emit(DemoScreen.Ready(next))
        } else {
            emit(DemoScreen.SaveFailed(current))
        }
    }

    private fun doReset() {
        when (val current = screen) {
            is DemoScreen.Ready, is DemoScreen.SaveFailed -> {
                val s = session ?: return
                emit(DemoScreen.Resetting)
                resetUnresolved = true
                try {
                    s.purgeDemoFamily()
                } catch (_: Exception) {
                    // One transaction: committed or rolled back. Reopening below shows which.
                }
                closeSession()
                openAndRecover()
            }
            is DemoScreen.Locked -> {
                if (!current.canReset) return
                emit(DemoScreen.Resetting)
                closeSession()
                val outcome = try {
                    store.setAside()
                } catch (_: Exception) {
                    SetAsideOutcome.INTERRUPTED // unknown: never "nothing changed"
                }
                if (outcome == SetAsideOutcome.NOT_STARTED) {
                    emit(current.copy(notice = lockedNotice(current.reason, DemoNotice.RESET_FAILED)))
                } else {
                    resetUnresolved = true
                    openAndRecover()
                }
            }
            DemoScreen.Opening, DemoScreen.Resetting -> Unit
        }
    }
}
