package com.penningtonlabs.baileyscart

import androidx.compose.runtime.Composable
import androidx.lifecycle.ViewModelStoreOwner

/** RELEASE build entry: the WP-00 placeholder, unchanged. BC-UI-S1 demo code is debug-only. */
internal object AppEntry {
    const val LOCAL_DEMO_ENABLED: Boolean = false

    @Composable
    @Suppress("UNUSED_PARAMETER")
    fun Content(owner: ViewModelStoreOwner) {
        PlaceholderContent()
    }
}
