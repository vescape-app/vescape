package app.vescape.wear

import androidx.compose.runtime.mutableStateOf
import expo.modules.vescapecore.watch.WatchRouteStatus
import expo.modules.vescapecore.watch.WatchRouteStatusCodec
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.cos

/**
 * @parity /modules/vescape-core/ios/watch/WatchRoute.swift `watchRouteChannel`
 */
const val ROUTE_PATH = "/route"

private const val WATCH_ROUTE_VERSION = 1
private const val WATCH_ROUTE_HEADER_BYTES = 1 + 2 + 8 + 8
private const val MICRO_DEGREES = 1_000_000.0

private const val METERS_PER_DEGREE_LAT = 110_574.0
private const val METERS_PER_DEGREE_LON_EQUATOR = 111_320.0

/** @parity /modules/vescape-core/ios/watch/WatchRoute.swift `WatchRoute` */
data class WatchRoute(val points: List<RoutePoint>, val routeId: Long? = null)

/** @parity /modules/vescape-core/ios/watch/WatchRoute.swift `WatchRoutePoint` */
data class RoutePoint(val eastM: Float, val northM: Float)

/**
 * @parity /watch/watchos/PhoneLink.swift `route`
 */
object RouteState {
    val route = mutableStateOf<WatchRoute?>(null)
    val status = mutableStateOf<WatchRouteStatus?>(null)

    fun accept(route: WatchRoute?) {
        this.route.value = route
    }
}

/**
 * @parity /modules/vescape-core/ios/watch/WatchRoute.swift `WatchRouteCodec`
 */
object WatchRouteDecoder {
    fun decode(bytes: ByteArray): WatchRoute? {
        if (bytes.size < WATCH_ROUTE_HEADER_BYTES) return null
        val buf = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
        if (buf.get().toInt() != WATCH_ROUTE_VERSION) return null
        val count = buf.short.toInt() and 0xFFFF
        if (count == 0) return null
        if (bytes.size < WATCH_ROUTE_HEADER_BYTES + (count - 1) * 8) return null
        val originLat = buf.double
        buf.double
        val lonScale = METERS_PER_DEGREE_LON_EQUATOR * cos(Math.toRadians(originLat))

        val points = ArrayList<RoutePoint>(count)
        points.add(RoutePoint(0f, 0f))
        var lat = 0L
        var lon = 0L
        for (index in 1 until count) {
            lat += buf.int
            lon += buf.int
            val east = lon / MICRO_DEGREES * lonScale
            val north = lat / MICRO_DEGREES * METERS_PER_DEGREE_LAT
            points.add(RoutePoint(east.toFloat(), north.toFloat()))
        }
        return WatchRoute(points, WatchRouteStatusCodec.routeId(bytes))
    }
}
