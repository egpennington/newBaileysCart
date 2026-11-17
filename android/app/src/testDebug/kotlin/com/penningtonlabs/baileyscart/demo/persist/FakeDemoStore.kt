package com.penningtonlabs.baileyscart.demo.persist

import com.penningtonlabs.baileyscart.core.model.offline.AccountKey
import com.penningtonlabs.baileyscart.core.model.offline.FamilyKey
import com.penningtonlabs.baileyscart.core.model.offline.FamilyOutbox
import com.penningtonlabs.baileyscart.demo.LocalDemoList

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
    var setAsideResult = true
    var setAsideThrows = false

    /** Called inside compareAndSet before it returns (commit-before-render probes). */
    var onCas: (expected: FamilyOutbox?, updated: FamilyOutbox) -> Unit = { _, _ -> }

    data class Cas(val expected: FamilyOutbox?, val updated: FamilyOutbox, val applied: Boolean)

    val casCalls = mutableListOf<Cas>()
    var opens = 0
    var purges = 0
    var setAsides = 0
    var closes = 0
    var openSessions = 0

    override fun open(): DemoStoreOpen {
        opens++
        if (openThrows) throw IllegalStateException("keystore unavailable (test)")
        lock?.let { return it }
        openSessions++
        return DemoStoreOpen.Opened(Session())
    }

    override fun setAside(): Boolean {
        setAsides++
        check(openSessions == 0) { "set-aside with an open session" }
        if (setAsideThrows) throw IllegalStateException("move failed (test)")
        if (setAsideResult) {
            stored = null
            otherScopes = 0
            lock = null
            recoverThrows = false
        }
        return setAsideResult
    }

    private inner class Session : DemoStoreSession {
        private var closed = false
        override val key: FamilyKey = this@FakeDemoStore.key

        override fun hasAnyScope(): Boolean = stored != null || otherScopes > 0

        override fun recover(): FamilyOutbox? {
            check(!closed)
            if (recoverThrows) throw IllegalStateException("stored outbox violates S2a invariants (test)")
            return stored
        }

        override fun compareAndSet(expected: FamilyOutbox?, updated: FamilyOutbox): Boolean {
            check(!closed)
            onCas(expected, updated)
            if (casThrows) {
                casCalls += Cas(expected, updated, applied = false)
                throw IllegalStateException("disk full (test)")
            }
            val applied = casResult ?: (stored == expected)
            if (applied) stored = updated
            casCalls += Cas(expected, updated, applied)
            return applied
        }

        override fun purgeDemoFamily() {
            check(!closed)
            purges++
            if (purgeThrows) throw IllegalStateException("purge rolled back (test)")
            stored = null
        }

        override fun close() {
            if (closed) return
            closed = true
            closes++
            openSessions--
        }
    }
}
