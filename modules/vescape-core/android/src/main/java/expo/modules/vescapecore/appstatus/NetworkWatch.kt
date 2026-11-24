package expo.modules.vescapecore.appstatus

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import androidx.annotation.AnyThread
import androidx.annotation.BinderThread

/** @parity /modules/vescape-core/ios/appstatus/NetworkWatch.swift `watchNetwork` */
@AnyThread
internal fun watchNetwork(context: Context, onNewNetwork: () -> Unit): () -> Unit {
    val manager = context.getSystemService(ConnectivityManager::class.java) ?: return {}
    val callback = object : ConnectivityManager.NetworkCallback() {
        @Volatile private var current: Network? = manager.activeNetwork

        @BinderThread
        override fun onAvailable(network: Network) {
            if (network == current) return
            current = network
            onNewNetwork()
        }

        @BinderThread
        override fun onLost(network: Network) {
            if (network == current) current = null
        }
    }
    manager.registerDefaultNetworkCallback(callback)
    return { manager.unregisterNetworkCallback(callback) }
}
