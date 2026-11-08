package com.penningtonlabs.baileyscart.core.model.offline

/*
 * Storage ports only. No production implementation exists in S2a; test-only in-memory fakes
 * live under src/test. Concrete adapters (Room/SQLCipher/Keystore, partitioning, sign-out
 * retention) are deferred to S2b and need PL decisions D-2..D-5 and D-7. These interfaces leak
 * no schema and claim no durability.
 */

/** Authoritative snapshot storage, partitioned by [FamilyKey]. */
interface LocalListStore {
    fun read(key: FamilyKey): ServerSnapshot?

    /** Replace the snapshot for `snapshot.key` atomically. Implementations must never write across keys. */
    fun replace(snapshot: ServerSnapshot)
}

/** Outbox storage, partitioned by [FamilyKey], with atomic compare-and-set replacement. */
interface OutboxStore {
    fun read(key: FamilyKey): FamilyOutbox?

    /**
     * Atomically store [updated] only if the stored value equals [expected] (null = absent).
     * Returns false and changes nothing otherwise. `updated.key` must equal [key].
     */
    fun compareAndSet(key: FamilyKey, expected: FamilyOutbox?, updated: FamilyOutbox): Boolean
}
