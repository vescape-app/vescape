package expo.modules.vescapecore.watch

import expo.modules.vescapecore.service.VESC_SESSION_TAG

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Log
import androidx.core.content.ContextCompat
import androidx.wear.remote.interactions.RemoteActivityHelper
import com.google.android.gms.tasks.Tasks
import com.google.android.gms.wearable.CapabilityClient
import com.google.android.gms.wearable.Wearable
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/** Must match the browsable VIEW intent-filter on the Mirror's MainActivity (watch/wearos AndroidManifest). */
private const val WATCH_MIRROR_URI = "vescape://mirror"

/**
 * Phone -> watch app launch on board connect. Asks Wear OS to bring the Watch Mirror to the
 * foreground via [RemoteActivityHelper], targeting only nodes that declare
 * [WATCH_MIRROR_CAPABILITY] so a merely-paired watch is never poked. Fire-and-forget: the ride
 * never depends on this — outcomes only [record] to the in-app diagnostic event log.
 */
internal class WatchMirrorLauncher(
    private val context: Context,
    private val scope: CoroutineScope,
    private val record: (String, Map<String, Any?>) -> Unit,
) {
    private val capabilityClient by lazy { Wearable.getCapabilityClient(context) }
    private val remoteActivityHelper by lazy { RemoteActivityHelper(context) }

    fun launch() {
        scope.launch(Dispatchers.IO) {
            val nodes = runCatching {
                Tasks.await(
                    capabilityClient.getCapability(WATCH_MIRROR_CAPABILITY, CapabilityClient.FILTER_REACHABLE),
                ).nodes
            }.getOrNull().orEmpty()
            if (nodes.isEmpty()) {
                Log.d(VESC_SESSION_TAG, "Watch mirror launch skipped: no capable node")
                record("watch_mirror_launch_skipped", emptyMap())
                return@launch
            }
            val intent = Intent(Intent.ACTION_VIEW)
                .addCategory(Intent.CATEGORY_BROWSABLE)
                .setData(Uri.parse(WATCH_MIRROR_URI))
                .setPackage(context.packageName)
            for (node in nodes) {
                val future = remoteActivityHelper.startRemoteActivity(intent, node.id)
                future.addListener({
                    runCatching { future.get() }
                        .onSuccess {
                            Log.d(VESC_SESSION_TAG, "Watch mirror launched node=${node.id}")
                            record("watch_mirror_launched", mapOf("node" to node.id))
                        }
                        .onFailure {
                            Log.w(VESC_SESSION_TAG, "Watch mirror launch failed: ${it.message}")
                            record("watch_mirror_launch_failed", mapOf("node" to node.id, "error" to it.message))
                        }
                }, ContextCompat.getMainExecutor(context))
            }
        }
    }
}
