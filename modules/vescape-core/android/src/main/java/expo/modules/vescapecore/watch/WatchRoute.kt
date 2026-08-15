package expo.modules.vescapecore.watch

import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.cos
import kotlin.math.roundToInt
import kotlin.math.roundToLong

/**
 * Data-layer path the route polyline rides on. A route is pushed once per route change and then
 * sits on the watch, unlike the per-tick Watch Frame — so it uses the Data Layer (last value wins,
 * survives a disconnect and syncs when the watch comes back) rather than a MessageClient blast.
 *
 * The wrist-side decoder ([app.vescape.wear] `WatchRouteDecoder`) carries the same path, version and
 * wire layout by convention (ADR-0018/ADR-0019).
 */
internal const val WATCH_ROUTE_PATH = "/route"

internal const val WATCH_ROUTE_VERSION = 1

/**
 * Micro-degrees per encoded unit. Points ride as int32 deltas from the previous point, which keeps a
 * long route small (8 bytes per point) while staying exact to ~0.1 m.
 */
private const val MICRO_DEGREES = 1_000_000.0

/** Header: version byte + uint16 point count + two float64 origin coordinates. */
private const val WATCH_ROUTE_HEADER_BYTES = 1 + 2 + 8 + 8

/** Deltas are int32; a single hop beyond this is not representable and forces a new origin. */
internal const val WATCH_ROUTE_MAX_POINTS = 8_000

internal data class GeoPoint(val lat: Double, val lon: Double)

/**
 * Pure polyline -> bytes encoder. The first point becomes the origin (absolute, full float64
 * precision); every later point is a micro-degree delta from the one before it.
 *
 * Returns null for an empty route — "no route" is a clear, not an empty item, so the wrist never has
 * to tell a zero-length polyline from a missing one.
 */
internal object WatchRouteEncoder {
    fun encode(points: List<GeoPoint>): ByteArray? {
        if (points.isEmpty()) return null
        val kept = if (points.size > WATCH_ROUTE_MAX_POINTS) simplify(points, WATCH_ROUTE_MAX_POINTS) else points
        val origin = kept.first()
        return ByteBuffer.allocate(WATCH_ROUTE_HEADER_BYTES + (kept.size - 1) * 8)
            .order(ByteOrder.LITTLE_ENDIAN)
            .apply {
                put(WATCH_ROUTE_VERSION.toByte())
                putShort(kept.size.toShort())
                putDouble(origin.lat)
                putDouble(origin.lon)
                // Deltas are measured against what the decoder will have reconstructed, not against
                // the source point, so per-hop rounding cannot accumulate along a long route.
                var lat = 0L
                var lon = 0L
                for (index in 1 until kept.size) {
                    val point = kept[index]
                    val targetLat = ((point.lat - origin.lat) * MICRO_DEGREES).roundToLong()
                    val targetLon = ((point.lon - origin.lon) * MICRO_DEGREES).roundToLong()
                    putInt((targetLat - lat).toInt())
                    putInt((targetLon - lon).toInt())
                    lat = targetLat
                    lon = targetLon
                }
            }
            .array()
    }

    /**
     * Even stride down to [limit] points, endpoints kept. Cheap on purpose: this is a last-resort
     * guard against an absurdly dense route, not a shape-preserving simplification.
     */
    private fun simplify(points: List<GeoPoint>, limit: Int): List<GeoPoint> {
        val stride = (points.size - 1).toDouble() / (limit - 1)
        return (0 until limit).map { points[(it * stride).roundToInt().coerceAtMost(points.lastIndex)] }
    }
}

private const val METERS_PER_DEGREE_LAT = 110_574.0
private const val METERS_PER_DEGREE_LON_EQUATOR = 111_320.0

/**
 * Local flat-earth offset of [point] from [origin], metres east and north. Good to well under a
 * metre over the tens of kilometres a route spans, which is all the wrist drawing needs — and it
 * keeps the rider's position inside Float32 telemetry lanes without losing precision the way raw
 * latitude/longitude would.
 */
internal fun offsetMeters(origin: GeoPoint, point: GeoPoint): Pair<Double, Double> {
    val east = (point.lon - origin.lon) * METERS_PER_DEGREE_LON_EQUATOR * cos(Math.toRadians(origin.lat))
    val north = (point.lat - origin.lat) * METERS_PER_DEGREE_LAT
    return east to north
}
