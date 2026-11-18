package com.penningtonlabs.baileyscart

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.ViewModelStoreOwner
import com.penningtonlabs.baileyscart.demo.DemoHost
import com.penningtonlabs.baileyscart.demo.LocalDemoListViewModel

/**
 * DEBUG build entry (BC-UI-S1; BC-S2-LOCAL-PERSIST LP-2). It shows the LOCAL DEMO shopping list,
 * saved encrypted on this device for one fixed fictional demo identity.
 * The release source set has its own AppEntry that keeps the WP-00 placeholder, so release
 * builds contain no demo or storage code (release unit test and scripts/check-release-isolation.sh).
 */
internal object AppEntry {
    const val LOCAL_DEMO_ENABLED: Boolean = true

    @Composable
    fun Content(owner: ViewModelStoreOwner) {
        val viewModel = remember(owner) { ViewModelProvider(owner)[LocalDemoListViewModel::class.java] }
        DemoHost(
            screen = viewModel.screen,
            onAction = viewModel::dispatch,
            onReload = viewModel::reload,
            onConfirmedReset = viewModel::reset,
        )
    }
}
