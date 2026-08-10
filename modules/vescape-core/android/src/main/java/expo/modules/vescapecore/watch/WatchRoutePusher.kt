package expo.modules.vescapecore.watch

import android.content.Context
import android.util.Log
import com.google.android.gms.wearable.PutDataRequest
import com.google.android.gms.wearable.Wearable
import expo.modules.vescapecore.service.VESC_SESSION_TAG
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

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

    /** Origin of the route currently on the watch — the frame's rider offset is measured from it. */
    @Volatile
    var origin: GeoPoint? = null
        private set

    /** Replaces whatever route the watch holds. An empty [points] clears it, same as [clearRoute]. */
    fun pushRoute(points: List<GeoPoint>) {
        val encoded = WatchRouteEncoder.encode(points)
        if (encoded == null) {
            clearRoute()
            return
        }
        origin = points.first()
        scope.launch {
            val request = PutDataRequest.create(WATCH_ROUTE_PATH).apply {
                data = encoded
                // Cold data, but a re-route must land now rather than at the next sync window.
                setUrgent()
            }
            dataClient.putDataItem(request)
                .addOnSuccessListener { record("watch_route_pushed", mapOf("points" to points.size)) }
                .addOnFailureListener { error ->
                    Log.w(VESC_SESSION_TAG, "Watch route push failed", error)
                    record("watch_route_push_failed", mapOf("error" to error.message))
                }
        }
    }

    /** Removes the route from the watch, which hides the wrist polyline. */
    fun clearRoute() {
        origin = null
        scope.launch {
            dataClient.deleteDataItems(PutDataRequest.create(WATCH_ROUTE_PATH).uri)
                .addOnFailureListener { error ->
                    Log.w(VESC_SESSION_TAG, "Watch route clear failed", error)
                    record("watch_route_clear_failed", mapOf("error" to error.message))
                }
        }
    }
}
