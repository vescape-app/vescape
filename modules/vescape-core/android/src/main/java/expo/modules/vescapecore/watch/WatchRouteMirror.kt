package expo.modules.vescapecore.watch

import android.content.Context
import expo.modules.vescapecore.navigation.NavigationController
import expo.modules.vescapecore.service.CoreForegroundService
import expo.modules.vescapecore.telemetry.TelemetryRepository

/**
 * @parity /modules/vescape-core/ios/watch/WatchRouteMirror.swift `WatchRouteMirror`
 */
internal object WatchRouteMirror {
    @Volatile
    private var pusher: WatchRoutePusher? = null

    val origin: GeoPoint? get() = pusher?.origin

    val desiredRouteId: Long get() = pusher?.desiredRouteId ?: 0
    val failed: Boolean get() = pusher?.failed ?: false

    /**
     * @parity /modules/vescape-core/ios/watch/WatchRouteMirror.swift `mapRoute`
     */
    @Volatile
    var mapRoute: WatchMapRoute? = null
        private set

    @Volatile
    var viewportSpanM: Double? = null

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
            mapRoute = points?.takeIf { it.size >= 2 }?.let { path -> WatchMapRoute(path.map { (latitude, longitude) -> WatchMapPosition(latitude, longitude) }) }
            if (points == null) {
                active.clearRoute()
            } else {
                active.pushRoute(points.map { (latitude, longitude) -> GeoPoint(latitude, longitude) })
            }
        }
    }
}
