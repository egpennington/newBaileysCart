package com.penningtonlabs.baileyscart.demo.persist

import com.penningtonlabs.baileyscart.core.model.offline.AccountKey
import com.penningtonlabs.baileyscart.core.model.offline.FamilyKey
import com.penningtonlabs.baileyscart.core.model.offline.FamilyOutbox
import com.penningtonlabs.baileyscart.demo.LocalDemoList
import java.io.IOException

/**
 * In-memory stand-in for the encrypted store (JVM D1 tests only). [stored] plays the role of the
 * disk: it survives a "restart" (a new PersistentDemoList over the same fake). Every write is
 * recorded so tests can prove what was, and was not, written.
 */
class FakeDemoStore : DemoListStore {
    val key: FamilyKey = FamilyKey(checkNotNull(AccountKey.of("0123456789abcdef0123456789abcdef")), LocalDemoList.DEMO_FAMILY)

    /** The durable outbox for the demo family (null = no scope stored). */
    var stored: FamilyOutbox? = null

    /** Scopes of other families in the same account file (proves "not empty"). */
    var otherScopes: Int = 0

    /** When non-null, open() returns this lock. */
    var lock: DemoStoreOpen.Locked? = null

    var openThrows = false
    var recoverThrows = false

    /** Result override for the next compare-and-sets: null = real CAS, false = refuse, throw = exception. */
    var casResult: Boolean? = null
    var casThrows = false
    var purgeThrows = false
    var setAsideThrows = false

    /**
     * What the next set-aside does. INTERRUPTED models LP-1 after some moves: the files are not
     * readable any more and the recovery marker keeps the store locked as RECOVERY_PENDING.
     */
    var setAsideOutcome = SetAsideOutcome.DONE

    /** When true, every *Throws flag throws an IOException (checked in Java) instead of an IllegalStateException. */
    var throwsIo = false

    private fun fault(what: String): Exception =
        if (throwsIo) IOException("$what (test)") else IllegalStateException("$what (test)")

    /** Called inside compareAndSet before it returns (commit-before-render probes). */
    var onCas: (expected: FamilyOutbox?, updated: FamilyOutbox) -> Unit = { _, _ -> }

    data class Cas(val expected: FamilyOutbox?, val updated: FamilyOutbox, val applied: Boolean)

    val casCalls = mutableListOf<Cas>()
    var opens = 0
    var purges = 0
    var setAsides = 0
    var closes = 0
    var openSessions = 0

    /** LP-3a: the most sessions ever open at the same time (must stay 1 under a shared owner). */
    var maxOpenSessions = 0

    /** LP-3a: names of every thread that called into this store or one of its sessions. */
    val callThreads = mutableSetOf<String>()

    private fun called() {
        callThreads += Thread.currentThread().name
    }

    override fun open(): DemoStoreOpen {
        called()
        opens++
        if (openThrows) throw fault("keystore unavailable")
        lock?.let { return it }
        openSessions++
        maxOpenSessions = maxOf(maxOpenSessions, openSessions)
        return DemoStoreOpen.Opened(Session())
    }

    override fun setAside(): SetAsideOutcome {
        called()
        setAsides++
        check(openSessions == 0) { "set-aside with an open session" }
        if (setAsideThrows) throw fault("move failed")
        when (setAsideOutcome) {
            SetAsideOutcome.DONE -> {
                stored = null
                otherScopes = 0
                lock = null
                recoverThrows = false
            }
            SetAsideOutcome.INTERRUPTED -> lock = DemoStoreOpen.Locked(StoreLock.RECOVERY_PENDING, canSetAside = true)
            SetAsideOutcome.NOT_STARTED -> Unit
        }
        return setAsideOutcome
    }

    private inner class Session : DemoStoreSession {
        private var closed = false
        override val key: FamilyKey = this@FakeDemoStore.key

        override fun hasAnyScope(): Boolean = stored != null || otherScopes > 0

        override fun recover(): FamilyOutbox? {
            called()
            check(!closed)
            if (recoverThrows) throw fault("stored outbox violates S2a invariants")
            return stored
        }

        override fun compareAndSet(expected: FamilyOutbox?, updated: FamilyOutbox): Boolean {
            called()
            check(!closed)
            onCas(expected, updated)
            if (casThrows) {
                casCalls += Cas(expected, updated, applied = false)
                throw fault("disk full")
            }
            val applied = casResult ?: (stored == expected)
            if (applied) stored = updated
            casCalls += Cas(expected, updated, applied)
            return applied
        }

        override fun purgeDemoFamily() {
            called()
            check(!closed)
            purges++
            if (purgeThrows) throw fault("purge rolled back")
            stored = null
        }

        override fun close() {
            called()
            if (closed) return
            closed = true
            closes++
            openSessions--
        }
    }
}
