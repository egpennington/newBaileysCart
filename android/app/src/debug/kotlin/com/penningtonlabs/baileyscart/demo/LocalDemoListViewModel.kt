package com.penningtonlabs.baileyscart.demo

import android.app.Application
import android.os.Handler
import android.os.Looper
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import com.penningtonlabs.baileyscart.demo.persist.DemoScreen
import com.penningtonlabs.baileyscart.demo.persist.EncryptedDemoListStore
import com.penningtonlabs.baileyscart.demo.persist.PersistentDemoList
import com.penningtonlabs.baileyscart.demo.persist.TracingDemoListStore
import java.util.concurrent.Executor

/**
 * Holds the LOCAL DEMO screen state (BC-S2-LOCAL-PERSIST LP-2, LP-3a). The list is stored
 * encrypted on this device for one fixed fictional demo identity (E-11a) and recovered on the
 * next launch.
 *
 * All storage work runs on ONE process-wide background thread ([DemoPersistence]), in the order
 * the user acted, and only one ViewModel's session is open at a time: a newer ViewModel closes
 * the previous one's session before it opens its own. Results are posted to the main thread in
 * that same order, and only after the change was committed, so the screen never shows an unsaved
 * change. Once this ViewModel is cleared it writes, resets and publishes nothing more. The Undo
 * slot is in memory only.
 */
class LocalDemoListViewModel(application: Application) : AndroidViewModel(application) {
    var screen: DemoScreen by mutableStateOf(DemoScreen.Opening)
        private set

    private val instance = DemoPersistence.nextInstance()
    private val trace = DemoPersistence.trace
    private val main = Handler(Looper.getMainLooper())
    private val list = PersistentDemoList(
        store = TracingDemoListStore(EncryptedDemoListStore(application), instance, trace),
        serial = DemoPersistence.serial,
        publish = { next ->
            screen = next
            trace.event(instance, "PUBLISH", "screen=${next::class.simpleName}")
        },
        owner = DemoPersistence.owner,
        deliver = Executor { main.post(it) },
    )

    init {
        trace.event(instance, "VM_CREATED")
        list.start()
    }

    fun dispatch(action: DemoAction) = list.dispatch(action)

    fun reload() = list.reload()

    /** Call only after the user confirmed both reset steps. */
    fun reset() = list.reset()

    override fun onCleared() {
        trace.event(instance, "VM_CLEARED")
        list.close()
    }
}
