package com.penningtonlabs.baileyscart.demo

import android.util.Log
import com.penningtonlabs.baileyscart.demo.persist.DemoSessionOwner
import com.penningtonlabs.baileyscart.demo.persist.DemoTrace
import java.util.concurrent.Executor
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger

/**
 * BC-S2-LOCAL-PERSIST LP-3a: the process-wide persistence owner for the LOCAL DEMO (debug source
 * set only). Every LocalDemoListViewModel uses this ONE serial executor and this ONE session
 * owner, so storage work from an old and a new ViewModel is never concurrent and their sessions
 * never overlap. The executor lives as long as the process and is never shut down.
 */
internal object DemoPersistence {
    /** Logcat tag of the LP-3a trace. Must never appear in a release build (check-release-isolation.sh). */
    const val TRACE_TAG = "BCLP3-TRACE"

    const val THREAD_NAME = "local-demo-persistence"

    val serial: Executor = Executors.newSingleThreadExecutor { r -> Thread(r, THREAD_NAME) }

    val owner = DemoSessionOwner()

    val trace = DemoTrace { line -> Log.i(TRACE_TAG, line) }

    private val instances = AtomicInteger()

    fun nextInstance(): Int = instances.incrementAndGet()
}
