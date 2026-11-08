package com.penningtonlabs.baileyscart

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.ViewModelStoreOwner
import com.penningtonlabs.baileyscart.demo.LocalDemoListViewModel
import com.penningtonlabs.baileyscart.demo.ShoppingListDemoScreen

/**
 * DEBUG build entry (BC-UI-S1). It shows the LOCAL DEMO shopping list.
 * The release source set has its own AppEntry that keeps the WP-00 placeholder, so release
 * builds contain no demo code (verified by the release unit test).
 */
internal object AppEntry {
    const val LOCAL_DEMO_ENABLED: Boolean = true

    @Composable
    fun Content(owner: ViewModelStoreOwner) {
        val viewModel = remember(owner) { ViewModelProvider(owner)[LocalDemoListViewModel::class.java] }
        ShoppingListDemoScreen(state = viewModel.state, onAction = viewModel::dispatch)
    }
}
