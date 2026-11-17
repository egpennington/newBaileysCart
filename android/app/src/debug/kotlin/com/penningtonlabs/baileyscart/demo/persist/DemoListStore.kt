package com.penningtonlabs.baileyscart.demo.persist

import com.penningtonlabs.baileyscart.core.model.offline.FamilyKey
import com.penningtonlabs.baileyscart.core.model.offline.FamilyOutbox

/*
 * LP-2 seam between the LOCAL DEMO and encrypted storage (debug source set only). It exposes
 * exactly the LP-1 contracts the demo needs, the S2a OutboxStore compare-and-set and the LP-1
 * recovery read, and nothing else. The production adapter is EncryptedDemoListStore; JVM tests
 * use a fake. No method here may delete or recreate account files.
 */

/** Why the demo store cannot be used. Mirrors the LP-1 LockReason, plus two app-level cases. */
enum class StoreLock {
    TAG_KEY_MISSING,
    KEY_MISSING,
    UNWRAP_FAILED,
    KEY_TRANSIENT,
    DB_MISSING,
    DB_UNREADABLE,
    MIGRATION_FAILED,
    DOWNGRADE,
    RECOVERY_PENDING,

    /** The store opened, but its contents could not be decoded, projected or seeded. */
    STATE_UNREADABLE,

    /** Opening threw an unexpected error (for example a Keystore failure). */
    OPEN_ERROR,
}

sealed interface DemoStoreOpen {
    class Opened(val session: DemoStoreSession) : DemoStoreOpen

    /** [canSetAside]: a user-confirmed set-aside (move, never delete) is possible for this lock. */
    data class Locked(val reason: StoreLock, val canSetAside: Boolean) : DemoStoreOpen
}

interface DemoListStore {
    /** Open (or create, only when positively new) the demo account store. Never resets. */
    fun open(): DemoStoreOpen

    /**
     * Locked-store reset, called only after the user's two-step confirmation and with no session
     * open. Moves the demo account's files into quarantine (LP-1 RecoveryController); never
     * deletes. True only when the set-aside completed.
     */
    fun setAside(): Boolean
}

/** One open demo account store. Confined to the single persistence thread. */
interface DemoStoreSession {
    /** The demo family scope inside this account store. */
    val key: FamilyKey

    /** True if the store holds any family scope at all (used to prove a store is empty). */
    fun hasAnyScope(): Boolean

    /** LP-1 startup recovery read (SpikeStores.recover). Null = no scope stored for [key]. Throws on corruption. */
    fun recover(): FamilyOutbox?

    /** S2a OutboxStore.compareAndSet: one durable (synchronous=FULL) transaction, or nothing. */
    fun compareAndSet(expected: FamilyOutbox?, updated: FamilyOutbox): Boolean

    /** Healthy-store reset (user-confirmed): remove the demo family in one transaction. */
    fun purgeDemoFamily()

    fun close()
}
