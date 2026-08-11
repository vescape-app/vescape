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
 * Phone -> Wear OS route transport. The polyline is cold data: pushed once when the route changes,
 * cleared when it ends, and never re-sent per tick — so it rides the Data Layer, which keeps the
 * last value on the watch across disconnects instead of dropping it like an undelivered message.
 *
 * The rider's own position is *not* here: it moves every fix, so it rides the Watch Frame lanes
 * (see [WatchFrame.riderEastM]) as an offset from this route's origin.
 */
internal class WatchRoutePusher(
    private val context: Context,
    private val scope: CoroutineScope,
    private val record: (String, Map<String, Any?>) -> Unit,
) {
    private val dataClient by lazy { Wearable.getDataClient(context) }

    /**
     * Origin of the route the watch actually holds — the frame's rider offset is measured from it.
     *
     * Committed only once its write has landed, and never by a write a newer one has already
     * superseded. Anything looser lets the two halves of the wrist picture disagree: an origin
     * pointing at a route the watch does not have places the rider off the drawn line, and unlike a
     * one-frame skew that state lasts until the next route change.
     */
    @Volatile
    var origin: GeoPoint? = null
        private set

    /**
     * Serializes route mutations. The Data Layer is last-value-wins per path, so two writes in
     * flight at once can land in either order and leave the wrist holding the older route.
     */
    private val writes = Mutex()

    private val generationLock = Any()
    private var generation = 0

    /** Replaces whatever route the watch holds. An empty [points] clears it, same as [clearRoute]. */
    fun pushRoute(points: List<GeoPoint>) {
        val encoded = WatchRouteEncoder.encode(points)
        if (encoded == null) {
            clearRoute()
            return
        }
        mutate(
            nextOrigin = points.first(),
            succeeded = "watch_route_pushed" to mapOf<String, Any?>("points" to points.size),
            failed = "watch_route_push_failed",
            failureMessage = "Watch route push failed",
        ) {
            val request = PutDataRequest.create(WATCH_ROUTE_PATH).apply {
                data = encoded
                // Cold data, but a re-route must land now rather than at the next sync window.
                setUrgent()
            }
            Tasks.await(dataClient.putDataItem(request))
        }
    }

    /** Removes the route from the watch, which hides the wrist polyline. */
    fun clearRoute() {
        mutate(
            nextOrigin = null,
            succeeded = null,
            failed = "watch_route_clear_failed",
            failureMessage = "Watch route clear failed",
        ) {
            Tasks.await(dataClient.deleteDataItems(PutDataRequest.create(WATCH_ROUTE_PATH).uri))
        }
    }

    /**
     * Runs [write] in intent order and moves [origin] to [nextOrigin] only if it landed and no newer
     * mutation has been claimed since. A failed write leaves the previous origin standing, which is
     * still the route on the wrist.
     */
    private fun mutate(
        nextOrigin: GeoPoint?,
        succeeded: Pair<String, Map<String, Any?>>?,
        failed: String,
        failureMessage: String,
        write: () -> Unit,
    ) {
        val request = synchronized(generationLock) { ++generation }
        scope.launch {
            writes.withLock {
                // A mutation the rider has already replaced is not worth a round trip to the watch.
                if (synchronized(generationLock) { request != generation }) return@withLock
                try {
                    write()
                    synchronized(generationLock) { if (request == generation) origin = nextOrigin }
                    succeeded?.let { (event, properties) -> record(event, properties) }
                } catch (error: Exception) {
                    Log.w(VESC_SESSION_TAG, failureMessage, error)
                    record(failed, mapOf("error" to error.message))
                }
            }
        }
    }
}
