package com.penningtonlabs.baileyscart.demo.persist

import com.penningtonlabs.baileyscart.demo.DemoAction
import com.penningtonlabs.baileyscart.demo.DemoIds
import com.penningtonlabs.baileyscart.demo.DemoListState
import com.penningtonlabs.baileyscart.demo.LocalDemoList
import com.penningtonlabs.baileyscart.demo.RandomDemoIds
import java.util.concurrent.Executor

/** A one-shot outcome message shown with the next screen. */
enum class DemoNotice {
    /** The confirmed reset completed and the starting sample list is saved. */
    RESET_DONE,

    /** The reset failed before changing anything; the saved list is unchanged. */
    RESET_FAILED,

    /** The reset removed the old demo data but could not start a new list. */
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

    /** The store cannot be used. Nothing was deleted, seeded or recreated. */
    data class Locked(val reason: StoreLock, val canReset: Boolean, val notice: DemoNotice? = null) : DemoScreen
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
 *    never reported as done.
 */
class PersistentDemoList(
    private val store: DemoListStore,
    private val serial: Executor,
    private val publish: (DemoScreen) -> Unit,
    private val ids: DemoIds = RandomDemoIds,
) {
    private var session: DemoStoreSession? = null
    private var committed: DemoListState? = null
    private var screen: DemoScreen = DemoScreen.Opening

    fun start() = serial.execute { openAndRecover(onReady = null, onLocked = null) }

    /** "Try again" on a lock, or "Reload" after a failed save: re-read everything from disk. */
    fun reload() = serial.execute {
        if (screen is DemoScreen.Locked || screen is DemoScreen.SaveFailed) {
            closeSession()
            openAndRecover(onReady = null, onLocked = null)
        }
    }

    fun dispatch(action: DemoAction) = serial.execute { mutate(action) }

    /** User-confirmed reset (the UI has already shown both confirmation steps). */
    fun reset() = serial.execute { doReset() }

    fun close() = serial.execute { closeSession() }

    // ---- persistence thread only -------------------------------------------------------------

    private fun emit(next: DemoScreen) {
        screen = next
        publish(next)
    }

    private fun closeSession() {
        val s = session ?: return
        session = null
        committed = null
        runCatching { s.close() }
    }

    private fun openAndRecover(onReady: DemoNotice?, onLocked: DemoNotice?) {
        emit(DemoScreen.Opening)
        val opened = try {
            store.open()
        } catch (_: RuntimeException) {
            DemoStoreOpen.Locked(StoreLock.OPEN_ERROR, canSetAside = false)
        }
        when (opened) {
            is DemoStoreOpen.Locked -> emit(DemoScreen.Locked(opened.reason, opened.canSetAside, onLocked))
            is DemoStoreOpen.Opened -> {
                session = opened.session
                val state = try {
                    recoverOrSeed(opened.session)
                } catch (_: RuntimeException) {
                    null
                }
                if (state == null) {
                    closeSession()
                    emit(DemoScreen.Locked(StoreLock.STATE_UNREADABLE, canReset = true, notice = onLocked))
                } else {
                    committed = state
                    emit(DemoScreen.Ready(state, onReady))
                }
            }
        }
    }

    /** Null = fail closed (never treated as empty). */
    private fun recoverOrSeed(s: DemoStoreSession): DemoListState? {
        val stored = s.recover()
        if (stored != null) return LocalDemoList.fromOutbox(stored)
        // Positively new: no scope for any family, and the seed CAS against "absent" must win.
        if (s.hasAnyScope()) return null
        val seeded = LocalDemoList.seededOutbox(s.key)
        if (!s.compareAndSet(null, seeded)) return null
        return LocalDemoList.fromOutbox(seeded)
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
        } catch (_: RuntimeException) {
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
                val purged = try {
                    s.purgeDemoFamily()
                    true
                } catch (_: RuntimeException) {
                    false
                }
                closeSession()
                if (purged) {
                    // The demo scope is now absent, so recovery seeds the starting list once.
                    openAndRecover(onReady = DemoNotice.RESET_DONE, onLocked = DemoNotice.RESET_INCOMPLETE)
                } else {
                    // The purge transaction rolled back: show what is actually on disk.
                    openAndRecover(onReady = DemoNotice.RESET_FAILED, onLocked = DemoNotice.RESET_FAILED)
                }
            }
            is DemoScreen.Locked -> {
                if (!current.canReset) return
                emit(DemoScreen.Resetting)
                closeSession()
                val movedAside = try {
                    store.setAside()
                } catch (_: RuntimeException) {
                    false
                }
                if (movedAside) {
                    openAndRecover(onReady = DemoNotice.RESET_DONE, onLocked = DemoNotice.RESET_INCOMPLETE)
                } else {
                    emit(current.copy(notice = DemoNotice.RESET_FAILED))
                }
            }
            DemoScreen.Opening, DemoScreen.Resetting -> Unit
        }
    }
}
