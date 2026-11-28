package com.penningtonlabs.baileyscart.family

import android.net.ConnectivityManager
import android.net.Network
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.material3.MaterialTheme
import androidx.lifecycle.ViewModelProvider

/**
 * BC-FAMILY-SYNC-01 Step 2: the debug-only launcher for the shared family list (emulator only).
 * Declared in the debug manifest; the release app and the LOCAL DEMO in MainActivity are unchanged.
 *
 * Rev 2 section 5: listeners and the Firestore network are on only between onStart and onStop.
 * The network callback is registered for the same window, so nothing runs in the background.
 */
class FamilySyncActivity : ComponentActivity() {
    private lateinit var vm: FamilyViewModel
    private var callback: ConnectivityManager.NetworkCallback? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        vm = ViewModelProvider(this)[FamilyViewModel::class.java]
        setContent { MaterialTheme { FamilyHost(vm) } }
    }

    override fun onStart() {
        super.onStart()
        FamilySyncRuntime.trace("op=ACTIVITY_START")
        vm.onVisible()
        val cm = getSystemService(ConnectivityManager::class.java)
        val cb = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) = runOnUiThread { vm.onNetwork(true) }

            override fun onLost(network: Network) = runOnUiThread { vm.onNetwork(false) }
        }
        cm.registerDefaultNetworkCallback(cb)
        callback = cb
    }

    override fun onStop() {
        callback?.let { runCatching { getSystemService(ConnectivityManager::class.java).unregisterNetworkCallback(it) } }
        callback = null
        vm.onHidden()
        FamilySyncRuntime.trace("op=ACTIVITY_STOP")
        super.onStop()
    }
}
