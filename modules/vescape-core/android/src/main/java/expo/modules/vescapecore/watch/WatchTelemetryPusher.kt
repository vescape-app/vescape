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

/** How long a connected-node lookup is trusted before the next frame triggers a refresh. */
private const val NODE_CACHE_TTL_MS = 30_000L

/**
 * Phone -> Wear OS Mirror transport (ADR-0019). Fire-and-forget
 * [com.google.android.gms.wearable.MessageClient] send of an already-encoded Watch Frame to every
 * connected node. Lives native (in vescape-core, beside the telemetry truth) so it keeps pushing while
 * JS is backgrounded mid-ride. The frame is built and throttled by [WatchTick]; this only ships bytes.
 *
 * Delivery problems [record] one diagnostic event per issue streak (not per frame — frames flow at
 * ~2 Hz), plus one recovery event, so silent failures like a package/certificate mismatch between
 * phone and watch builds are readable from the in-app event log in the field.
 */
internal class WatchTelemetryPusher(
    private val context: Context,
    private val scope: CoroutineScope,
    private val record: (String, Map<String, Any?>) -> Unit,
) {
    private val messageClient by lazy { Wearable.getMessageClient(context) }
    private val nodeClient by lazy { Wearable.getNodeClient(context) }

    @Volatile
    private var activeIssue: String? = null

    /**
     * Cached target node ids. Looking these up is a blocking Play-services IPC, and at frame cadence
     * that costs more than the send it precedes — so it is refreshed on a slow TTL and invalidated
     * whenever a send fails, which is the event that actually means the node set moved.
     */
    @Volatile
    private var nodeIds: List<String> = emptyList()

    @Volatile
    private var nodeIdsAtMs: Long = 0L

    private val refreshing = AtomicBoolean(false)

    fun pushFrame(frame: ByteArray) {
        val targets = nodeIds
        // On the timestamp, never on emptiness: "no nodes" is a valid cached answer, and re-asking
        // for it every frame would restore the very 4 Hz blocking lookup the cache exists to remove.
        if (nodeIdsAtMs == 0L || SystemClock.elapsedRealtime() - nodeIdsAtMs > NODE_CACHE_TTL_MS) {
            refreshNodes()
        }
        // A frame is worthless once stale; the next tick ships against the refreshed cache.
        if (targets.isEmpty()) return
        for (nodeId in targets) {
            messageClient.sendMessage(nodeId, WATCH_TELEMETRY_PATH, frame)
                .addOnSuccessListener { reportRecovered() }
                .addOnFailureListener { error ->
                    invalidateNodes()
                    reportIssue(
                        "watch_frame_send_failed",
                        mapOf("node" to nodeId, "error" to error.message),
                    )
                }
        }
    }

    private fun refreshNodes() {
        if (!refreshing.compareAndSet(false, true)) return
        scope.launch {
            try {
                val nodes = runCatching { Tasks.await(nodeClient.connectedNodes) }.getOrNull()
                when {
                    nodes == null -> reportIssue("watch_nodes_lookup_failed")
                    nodes.isEmpty() -> reportIssue("watch_frame_no_nodes")
                }
                nodeIds = nodes.orEmpty().map { it.id }
                // A failed lookup is cached as "none" for the TTL too — retrying it at frame cadence
                // is what made the failure expensive, and the next pass is 30 s away.
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
