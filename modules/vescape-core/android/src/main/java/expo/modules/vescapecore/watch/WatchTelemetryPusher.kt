package expo.modules.vescapecore.watch

import expo.modules.vescapecore.service.VESC_SESSION_TAG

import android.content.Context
import android.os.SystemClock
import android.util.Log
import com.google.android.gms.tasks.Tasks
import com.google.android.gms.wearable.Wearable
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

private const val WATCH_TELEMETRY_PATH = "/telemetry"

private const val NODE_CACHE_TTL_MS = 30_000L

internal class WatchTelemetryPusher(
    private val context: Context,
    private val scope: CoroutineScope,
    private val record: (String, Map<String, Any?>) -> Unit,
) {
    private val messageClient by lazy { Wearable.getMessageClient(context) }
    private val nodeClient by lazy { Wearable.getNodeClient(context) }

    @Volatile
    private var activeIssue: String? = null

    @Volatile
    private var nodeIds: List<String> = emptyList()

    @Volatile
    private var nodeIdsAtMs: Long = 0L

    private val refreshing = AtomicBoolean(false)

    fun pushFrame(frame: ByteArray) = send(WATCH_TELEMETRY_PATH, frame)

    /**
     * @parity /modules/vescape-core/ios/watch/WatchTelemetryPusher.swift `pushGroupRideFrame`
     */
    fun pushGroupRideFrame(frame: ByteArray) = send(WATCH_GROUP_RIDE_PATH, frame)

    /** @parity /modules/vescape-core/ios/watch/WatchTelemetryPusher.swift `pushRouteStatus` */
    fun pushRouteStatus(status: WatchRouteStatus) = send(WATCH_ROUTE_STATUS_PATH, WatchRouteStatusCodec.encode(status))

    private fun send(path: String, frame: ByteArray) {
        val targets = nodeIds
        if (nodeIdsAtMs == 0L || SystemClock.elapsedRealtime() - nodeIdsAtMs > NODE_CACHE_TTL_MS) {
            refreshNodes()
        }
        if (targets.isEmpty()) return
        for (nodeId in targets) {
            messageClient.sendMessage(nodeId, path, frame)
                .addOnSuccessListener { reportRecovered() }
                .addOnFailureListener { error ->
                    invalidateNodes()
                    reportIssue(
                        "watch_frame_send_failed",
                        mapOf("node" to nodeId, "path" to path, "error" to error.message),
                    )
                }
        }
    }

    private fun refreshNodes() {
        if (!refreshing.compareAndSet(false, true)) return
        scope.launch {
            try {
                // intentional-suppression: missing nodes are reported by the null branch
                val nodes = runCatching { Tasks.await(nodeClient.connectedNodes) }.getOrNull()
                when {
                    nodes == null -> reportIssue("watch_nodes_lookup_failed")
                    nodes.isEmpty() -> reportIssue("watch_frame_no_nodes")
                }
                if (nodes != null) {
                    nodeIds = nodes.map { it.id }
                }
                nodeIdsAtMs = SystemClock.elapsedRealtime()
            } finally {
                refreshing.set(false)
            }
        }
    }

    private fun invalidateNodes() {
        nodeIdsAtMs = 0L
    }

    private fun reportIssue(name: String, properties: Map<String, Any?> = emptyMap()) {
        if (activeIssue != name) {
            Log.w(VESC_SESSION_TAG, "Watch push issue $name $properties")
            record(name, properties)
        }
        activeIssue = name
    }

    private fun reportRecovered() {
        if (activeIssue != null) {
            Log.d(VESC_SESSION_TAG, "Watch push recovered after $activeIssue")
            record("watch_frame_send_recovered", emptyMap())
        }
        activeIssue = null
    }
}
