package com.penningtonlabs.baileyscart.family

import com.penningtonlabs.baileyscart.core.model.offline.FamilyKey
import com.penningtonlabs.baileyscart.core.model.offline.FamilyOutbox
import com.penningtonlabs.baileyscart.core.model.offline.OutboxOperation
import com.penningtonlabs.baileyscart.core.model.offline.ServerItem
import com.penningtonlabs.baileyscart.core.model.offline.ServerSnapshot

/*
 * BC-FAMILY-SYNC-01 Step 2 (debug source set only; Sync Contract Rev 2). The ports between the
 * family sync engine and the outside world. The engine is pure Kotlin, so JVM tests drive it with
 * fakes; the Firebase emulator adapter (EmulatorBackend.kt) and the SQLCipher adapter
 * (EncryptedFamilyStore.kt) are the only production implementations, and both are debug-only.
 */

/** The outcome of one callable. Only [Rejected] carries a server decision. */
sealed interface CallResult<out T> {
    data class Ok<T>(val value: T) : CallResult<T>

    /** An API v0.4 rejection envelope: the server decided. */
    data class Rejected(val code: String, val retryable: Boolean) : CallResult<Nothing>

    /** The ID token was refused. Never treated as revocation. */
    data object Unauthenticated : CallResult<Nothing>

    /** No server decision is known (offline, timeout, transport failure). Never treated as revocation. */
    data object Unreachable : CallResult<Nothing>
}

/** One family the caller is an ACTIVE member of, as `account.getSession` reports it. */
data class SessionFamily(val familyId: String, val role: String, val accessMode: String)

data class FamilyRef(val familyId: String, val familyEpoch: Long)

/**
 * Callables. Every callback must be delivered on the engine's serial executor (the adapter is
 * given that executor), never on the calling thread.
 */
interface FamilyBackend {
    fun getSession(done: (CallResult<List<SessionFamily>>) -> Unit)

    fun createFamily(opId: String, done: (CallResult<FamilyRef>) -> Unit)

    fun createInvite(opId: String, familyId: String, familyEpoch: Long, done: (CallResult<String>) -> Unit)

    fun acceptInvite(opId: String, code: String, done: (CallResult<FamilyRef>) -> Unit)

    /** Send exactly [op] (its own opId, epoch and payload). Ok carries the item's server `rev`. */
    fun send(familyId: String, op: OutboxOperation, done: (CallResult<Long>) -> Unit)

    /** Force-refresh the ID token (after UNAUTHENTICATED). */
    fun refreshToken(done: (Boolean) -> Unit)
}

enum class ListenError { PERMISSION_DENIED, UNAUTHENTICATED, UNAVAILABLE, OTHER }

sealed interface ListEvent {
    /** The complete current read model. [fromCache] = not confirmed by the server. */
    data class Items(val items: List<ServerItem>, val fromCache: Boolean) : ListEvent

    /** `listMeta/current`. Null epoch = the document does not exist yet (epoch 1). */
    data class Meta(val familyEpoch: Long?, val fromCache: Boolean) : ListEvent

    data class Failed(val error: ListenError) : ListEvent
}

/** Firestore snapshot listeners. Events are delivered on the engine's serial executor. */
interface ListHub {
    fun attach(familyId: String, onEvent: (ListEvent) -> Unit): Attachment

    /** Firestore network on/off (memory cache only, so off means no traffic at all). */
    fun setNetworkEnabled(enabled: Boolean)

    fun interface Attachment {
        fun detach()
    }
}

/** One open per-(uid, family) encrypted store. Confined to the engine's serial executor. */
interface FamilyStoreSession {
    val key: FamilyKey

    fun recover(): FamilyOutbox?

    fun compareAndSet(expected: FamilyOutbox?, updated: FamilyOutbox): Boolean

    fun readSnapshot(): ServerSnapshot?

    fun replaceSnapshot(snapshot: ServerSnapshot)

    fun close()
}

sealed interface StoreOpen {
    class Opened(val session: FamilyStoreSession) : StoreOpen

    data class Locked(val reason: String) : StoreOpen
}

enum class PurgeOutcome {
    /** The family's Keystore key and every store file are gone. */
    DONE,

    /** The key was deleted (data unreadable) but some file could not be removed. */
    KEY_DELETED_FILES_REMAIN,

    /** The key could not be deleted. */
    FAILED,
}

interface FamilyStoreFactory {
    fun open(uid: String, familyId: String): StoreOpen

    /**
     * Revocation purge (Rev 2 section 2), with no session open: delete the family's Keystore key
     * FIRST, then the database, WAL, journal and key files of that one (uid, family) store.
     */
    fun purge(uid: String, familyId: String): PurgeOutcome
}

/** Delayed work while the app is visible (bounded retry backoff). Cancelled when hidden. */
fun interface RetryScheduler {
    /** Run [task] after [delayMillis]. The returned handle cancels it. */
    fun schedule(delayMillis: Long, task: () -> Unit): () -> Unit
}
