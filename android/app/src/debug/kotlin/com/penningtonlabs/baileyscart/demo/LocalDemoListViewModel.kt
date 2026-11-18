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
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * Holds the LOCAL DEMO screen state (BC-S2-LOCAL-PERSIST LP-2). The list is stored encrypted on
 * this device for one fixed fictional demo identity (E-11a) and recovered on the next launch.
 *
 * All storage work runs on ONE background thread, in the order the user acted. Results are
 * posted to the main thread in that same order, and only after the change was committed, so the
 * screen never shows an unsaved change. The Undo slot is in memory only.
 */
class LocalDemoListViewModel(application: Application) : AndroidViewModel(application) {
    var screen: DemoScreen by mutableStateOf(DemoScreen.Opening)
        private set

    private val main = Handler(Looper.getMainLooper())
    private val persistence: ExecutorService = Executors.newSingleThreadExecutor { r ->
        Thread(r, "local-demo-persistence")
    }
    private val list = PersistentDemoList(
        store = EncryptedDemoListStore(application),
        serial = persistence,
        publish = { next -> main.post { screen = next } },
    )

    init {
        list.start()
    }

    fun dispatch(action: DemoAction) = list.dispatch(action)

    fun reload() = list.reload()

    /** Call only after the user confirmed both reset steps. */
    fun reset() = list.reset()

    override fun onCleared() {
        list.close()
        persistence.shutdown()
    }
}
