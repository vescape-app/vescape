package expo.modules.vescapecore.watch

import android.content.Context
import expo.modules.vescapecore.navigation.NavigationController
import expo.modules.vescapecore.service.CoreForegroundService
import expo.modules.vescapecore.telemetry.TelemetryRepository

/**
 * Keeps the watch's copy of the route in step with the Navigation the rider is following.
 *
 * Process-scoped on purpose. A route is Navigation truth, not session truth: it is pushed the moment
 * a Navigation is published — cold start restore included — and cleared when it ends, whether or not
 * a board is connected. The per-fix half of the same picture (where the rider is on that route)
 * rides the Watch Frame lanes instead, measured from [origin].
 *
 * The Wear Mirror is Android-only, so this has no iOS peer.
 */
internal object WatchRouteMirror {
    @Volatile
    private var pusher: WatchRoutePusher? = null

    /** Origin of the route currently on the watch; the frame's rider lanes are offsets from it. */
    val origin: GeoPoint? get() = pusher?.origin

    /** Settled phone-map horizontal viewport span, carried on the next live Watch Frame. */
    @Volatile
    var viewportSpanM: Double? = null

    /**
     * Attaches to [controller] so every published path lands on the watch. Idempotent: attaching
     * again over a live mirror keeps the pusher (and its origin) rather than orphaning the route
     * already on the wrist.
     */
    fun attach(controller: NavigationController, context: Context) {
        val applicationContext = context.applicationContext
        val active = pusher ?: WatchRoutePusher(
            applicationContext,
            CoreForegroundService.appDataScope,
            { name, properties ->
                TelemetryRepository.get(applicationContext)
                    .recordDiagnosticEvent(name, properties + mapOf("operation" to "watch"))
            },
        ).also { pusher = it }
        controller.onPathChange = { points ->
            if (points == null) {
                active.clearRoute()
            } else {
                active.pushRoute(points.map { (latitude, longitude) -> GeoPoint(latitude, longitude) })
            }
        }
    }
}
