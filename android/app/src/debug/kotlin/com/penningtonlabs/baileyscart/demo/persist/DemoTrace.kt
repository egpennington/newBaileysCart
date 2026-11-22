package com.penningtonlabs.baileyscart.demo.persist

import com.penningtonlabs.baileyscart.core.model.offline.FamilyOutbox
import java.util.concurrent.atomic.AtomicLong

/**
 * BC-S2-LOCAL-PERSIST LP-3a: lifecycle and storage-order trace (debug source set only; never in a
 * release build). One line per event: a sequence number (per process), the ViewModel instance,
 * the calling thread and the operation. No list contents, keys, paths or identities are traced.
 *
 * Format: `seq=<n> inst=<id> thread=<name> op=<OP>[ <detail>]`. The D3 checker
 * (bc-lp3-evidence/scripts/trace_check.py) reads these lines from logcat.
 */
class DemoTrace(private val sink: (String) -> Unit) {
    private val seq = AtomicLong()

    /** Synchronized so that the log order is the sequence order, across threads. */
    @Synchronized
    fun event(instance: Int, op: String, detail: String = "") {
        val line = "seq=${seq.incrementAndGet()} inst=$instance thread=${Thread.currentThread().name} op=$op"
        sink(if (detail.isEmpty()) line else "$line $detail")
    }
}

/**
 * Traces every storage call made by one ViewModel [instance]: OPEN, RECOVER, CAS, PURGE, CLOSE
 * and SETASIDE, each with phase=begin and phase=end (result). Behavior is unchanged: results and
 * exceptions pass through as they are.
 */
class TracingDemoListStore(
    private val inner: DemoListStore,
    private val instance: Int,
    private val trace: DemoTrace,
) : DemoListStore {
    private inline fun <T> traced(op: String, result: (T) -> String, block: () -> T): T {
        trace.event(instance, op, "phase=begin")
        val r = try {
            block()
        } catch (e: Exception) {
            trace.event(instance, op, "phase=end result=THREW")
            throw e
        }
        trace.event(instance, op, "phase=end result=${result(r)}")
        return r
    }

    override fun open(): DemoStoreOpen {
        val opened = traced("OPEN", { r: DemoStoreOpen ->
            when (r) {
                is DemoStoreOpen.Opened -> "OPENED"
                is DemoStoreOpen.Locked -> "LOCKED:${r.reason}"
            }
        }) { inner.open() }
        return if (opened is DemoStoreOpen.Opened) DemoStoreOpen.Opened(Session(opened.session)) else opened
    }

    override fun setAside(): SetAsideOutcome = traced("SETASIDE", { r: SetAsideOutcome -> r.name }) { inner.setAside() }

    private inner class Session(private val s: DemoStoreSession) : DemoStoreSession {
        override val key get() = s.key

        override fun hasAnyScope(): Boolean = s.hasAnyScope()

        override fun recover() = traced("RECOVER", { r: Any? -> if (r == null) "ABSENT" else "PRESENT" }) { s.recover() }

        override fun compareAndSet(expected: FamilyOutbox?, updated: FamilyOutbox): Boolean =
            traced("CAS", { r: Boolean -> r.toString() }) { s.compareAndSet(expected, updated) }

        override fun purgeDemoFamily() = traced("PURGE", { _: Unit -> "DONE" }) { s.purgeDemoFamily() }

        override fun close() = traced("CLOSE", { _: Unit -> "DONE" }) { s.close() }
    }
}
