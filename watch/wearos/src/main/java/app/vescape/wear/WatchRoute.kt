package app.vescape.wear

import androidx.compose.runtime.mutableStateOf
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.cos

/**
 * Data Layer path the phone pushes the route polyline on. Must match the phone-side
 * `WatchRoutePusher`. Unlike the Watch Frame this arrives once per route change and then persists,
 * so a long polyline is never re-sent per tick.
 */
const val ROUTE_PATH = "/route"

private const val WATCH_ROUTE_VERSION = 1
private const val WATCH_ROUTE_HEADER_BYTES = 1 + 2 + 8 + 8
private const val MICRO_DEGREES = 1_000_000.0

private const val METERS_PER_DEGREE_LAT = 110_574.0
private const val METERS_PER_DEGREE_LON_EQUATOR = 111_320.0

/**
 * A route in the wrist's drawing frame: points as metres east/north of the route origin, which is
 * the same frame the Watch Frame's rider lanes use, so placing the rider is a straight subtraction.
 */
data class WatchRoute(val points: List<RoutePoint>)

data class RoutePoint(val eastM: Float, val northM: Float)

/** Latest route held on the wrist. Null means the phone has no active route. */
object RouteState {
    val route = mutableStateOf<WatchRoute?>(null)

    fun accept(route: WatchRoute?) {
        this.route.value = route
    }
}

/**
 * Pure bytes -> [WatchRoute] decoder: version byte, uint16 count, float64 origin, then int32
 * micro-degree deltas from the previous point. Returns null on an unknown version or a short buffer,
 * so a newer phone format degrades to "no route" instead of a garbled line.
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
        buf.double // origin longitude: points are relative, only the origin's latitude scales them
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
        return WatchRoute(points)
    }
}
