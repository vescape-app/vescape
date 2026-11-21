package expo.modules.vescapecore.watch

import expo.modules.vescapecore.BuildConfig

import expo.modules.vescapecore.service.VESC_SESSION_TAG

import android.content.Context
import android.util.Log
import com.google.android.gms.tasks.Tasks
import com.google.android.gms.wearable.CapabilityClient
import com.google.android.gms.wearable.Wearable
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

internal const val WATCH_MIRROR_CAPABILITY = "vescape_watch_mirror"

internal const val WATCH_MIRROR_WAKE_CAPABILITY = "vescape_watch_mirror_wake"

private val PRESENCE_REFRESH_BURST_MS = longArrayOf(1_000L, 2_000L, 5_000L)
private const val PRESENCE_REFRESH_STEADY_MS = 15_000L

internal class WatchMirrorPresence(
    private val context: Context,
    private val scope: CoroutineScope,
    private val record: (String, Map<String, Any?>) -> Unit,
) {
    private val capabilityClient by lazy { Wearable.getCapabilityClient(context) }
    private val nodeClient by lazy { Wearable.getNodeClient(context) }

    @Volatile
    var present: Boolean = false
        private set

    @Volatile
    var reportsWakeLevel: Boolean = false
        private set

    private var refreshJob: Job? = null

    private val listener = CapabilityClient.OnCapabilityChangedListener { info ->
        if (info.name == WATCH_MIRROR_WAKE_CAPABILITY) {
            reportsWakeLevel = info.nodes.isNotEmpty()
            return@OnCapabilityChangedListener
        }
        update(info.nodes.isNotEmpty(), source = "listener")
    }

    fun start() {
        if (refreshJob?.isActive == true) return
        capabilityClient.addListener(listener, WATCH_MIRROR_CAPABILITY)
        capabilityClient.addListener(listener, WATCH_MIRROR_WAKE_CAPABILITY)
        refreshJob = scope.launch(Dispatchers.IO) {
            var attempt = 0
            while (isActive) {
                // intentional-suppression: watch presence errors are reported or lifecycle teardown is best effort
                val capabilityPresent = runCatching {
                    Tasks.await(
                        capabilityClient.getCapability(WATCH_MIRROR_CAPABILITY, CapabilityClient.FILTER_REACHABLE),
                    )
                }.onFailure { record("watch_mirror_presence_query_failed", mapOf("capability" to "mirror")) }
                    .getOrNull()?.nodes?.isNotEmpty()
                // intentional-suppression: watch presence errors are reported or lifecycle teardown is best effort
                val wakePresent = runCatching {
                    Tasks.await(
                        capabilityClient.getCapability(WATCH_MIRROR_WAKE_CAPABILITY, CapabilityClient.FILTER_REACHABLE),
                    )
                }.onFailure { record("watch_mirror_presence_query_failed", mapOf("capability" to "wake")) }
                    .getOrNull()?.nodes?.isNotEmpty()
                if (capabilityPresent != null && wakePresent != null) {
                    reportsWakeLevel = wakePresent
                    val debugPresent = if (capabilityPresent) false else debugReachableWearNode()
                    if (debugPresent != null) {
                        update(capabilityPresent || debugPresent, source = "refresh", force = attempt == 0)
                    }
                }
                delay(PRESENCE_REFRESH_BURST_MS.getOrElse(attempt) { PRESENCE_REFRESH_STEADY_MS })
                attempt++
            }
        }
    }

    fun stop() {
        refreshJob?.cancel()
        refreshJob = null
        // intentional-suppression: watch presence errors are reported or lifecycle teardown is best effort
        runCatching { capabilityClient.removeListener(listener, WATCH_MIRROR_CAPABILITY) }
        // intentional-suppression: watch presence errors are reported or lifecycle teardown is best effort
        runCatching { capabilityClient.removeListener(listener, WATCH_MIRROR_WAKE_CAPABILITY) }
        present = false
        reportsWakeLevel = false
    }

    private fun update(next: Boolean, source: String, force: Boolean = false) {
        val changed = next != present
        present = next
        if (!changed && !force) return
        Log.d(VESC_SESSION_TAG, "Watch mirror presence: $next source=$source")
        scope.launch(Dispatchers.IO) {
            // intentional-suppression: watch presence errors are reported or lifecycle teardown is best effort
            val connectedNodes = runCatching { Tasks.await(nodeClient.connectedNodes) }.getOrNull()?.size
            record(
                if (next) "watch_mirror_present" else "watch_mirror_absent",
                mapOf("source" to source, "connected_nodes" to connectedNodes),
            )
        }
    }

    private fun debugReachableWearNode(): Boolean? {
        if (!BuildConfig.DEBUG) return false

        // intentional-suppression: watch presence errors are reported or lifecycle teardown is best effort
        return runCatching { Tasks.await(nodeClient.connectedNodes) }
            .onFailure { record("watch_mirror_nodes_query_failed", emptyMap()) }
            .getOrNull()?.isNotEmpty()
    }
}
