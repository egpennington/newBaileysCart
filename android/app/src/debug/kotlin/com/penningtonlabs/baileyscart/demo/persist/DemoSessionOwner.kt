package com.penningtonlabs.baileyscart.demo.persist

import java.util.concurrent.Executor

/**
 * BC-S2-LOCAL-PERSIST LP-3a: the one owner of the demo store session (debug source set only).
 *
 * Every [PersistentDemoList] that shares this owner must share its one serial executor. The owner
 * is used only on that executor's thread, so taking over is ordered with every storage call: the
 * previous instance is retired (its session closed, all its later work dropped) before the new
 * instance opens the store. Two sessions are therefore never open at the same time, even when
 * Android creates the next ViewModel before it clears the previous one.
 */
class DemoSessionOwner {
    private var current: PersistentDemoList? = null
    private var boundSerial: Executor? = null

    /** Persistence thread only. Retires the previous instance, then records [next] as the owner. */
    internal fun takeOver(next: PersistentDemoList, serial: Executor) {
        val bound = boundSerial
        check(bound == null || bound === serial) { "instances sharing a DemoSessionOwner must share one serial executor" }
        boundSerial = serial
        val previous = current
        current = next
        if (previous != null && previous !== next) previous.retire()
    }

    /** Persistence thread only. Called when [list] closes itself. */
    internal fun release(list: PersistentDemoList) {
        if (current === list) current = null
    }
}
