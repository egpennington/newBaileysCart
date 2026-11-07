package com.penningtonlabs.baileyscart.demo

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel

/**
 * Holds the single LOCAL DEMO state in memory. It survives configuration changes such as
 * rotation or font scaling, but not process death. The state is deliberately not written to
 * saved-instance state or disk.
 */
class LocalDemoListViewModel : ViewModel() {
    var state: DemoListState by mutableStateOf(LocalDemoList.initialState())
        private set

    fun dispatch(action: DemoAction) {
        state = LocalDemoList.reduce(state, action)
    }
}
