package expo.modules.vescapecore.watch

import android.content.Context
import android.util.Log
import com.google.android.gms.tasks.Tasks
import com.google.android.gms.wearable.PutDataRequest
import com.google.android.gms.wearable.Wearable
import expo.modules.vescapecore.service.VESC_SESSION_TAG
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * @parity /modules/vescape-core/ios/watch/WatchRouteMirror.swift `WatchRouteMirror`
 * @platform-diff `updateApplicationContext` is synchronous and latest-value-wins, so the iOS peer
 */
internal class WatchRoutePusher(
    private val context: Context,
    private val scope: CoroutineScope,
    private val record: (String, Map<String, Any?>) -> Unit,
) {
    private val dataClient by lazy { Wearable.getDataClient(context) }

    @Volatile
    var origin: GeoPoint? = null
        private set

    private val writes = Mutex()

    @Volatile var desiredRouteId: Long = 0
        private set
    @Volatile var failed: Boolean = false
        private set

    private val generationLock = Any()
    private var generation = 0

    fun pushRoute(points: List<GeoPoint>) {
        val encoded = WatchRouteEncoder.encode(points)
        if (encoded == null) {
            clearRoute()
            return
        }
        mutate(
            nextRouteId = WatchRouteStatusCodec.routeId(encoded),
            nextOrigin = points.first(),
            succeeded = "watch_route_pushed" to mapOf<String, Any?>("points" to points.size),
            failed = "watch_route_push_failed",
            failureMessage = "Watch route push failed",
        ) {
            val request = PutDataRequest.create(WATCH_ROUTE_PATH).apply {
                data = encoded
                setUrgent()
            }
            Tasks.await(dataClient.putDataItem(request))
        }
    }

    fun clearRoute() {
        mutate(
            nextRouteId = 0,
            nextOrigin = null,
            succeeded = null,
            failed = "watch_route_clear_failed",
            failureMessage = "Watch route clear failed",
        ) {
            Tasks.await(dataClient.deleteDataItems(PutDataRequest.create(WATCH_ROUTE_PATH).uri))
        }
    }

    private fun mutate(
        nextRouteId: Long,
        nextOrigin: GeoPoint?,
        succeeded: Pair<String, Map<String, Any?>>?,
        failed: String,
        failureMessage: String,
        write: () -> Unit,
    ) {
        val request = synchronized(generationLock) {
            desiredRouteId = nextRouteId
            this.failed = false
            ++generation
        }
        scope.launch {
            writes.withLock {
                if (synchronized(generationLock) { request != generation }) return@withLock
                try {
                    write()
                    origin = nextOrigin
                    succeeded?.let { (event, properties) -> record(event, properties) }
                } catch (error: Exception) {
                    synchronized(generationLock) { if (request == generation) this@WatchRoutePusher.failed = true }
                    Log.w(VESC_SESSION_TAG, failureMessage, error)
                    record(failed, mapOf("error" to error.message))
                }
            }
        }
    }
}
