package expo.modules.vescapecore.watch

import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.cos
import kotlin.math.roundToInt
import kotlin.math.roundToLong

/**
 * @parity /modules/vescape-core/ios/watch/WatchRoute.swift `watchRouteChannel`
 */
internal const val WATCH_ROUTE_PATH = "/route"

/** @parity /modules/vescape-core/ios/watch/WatchRoute.swift `WATCH_ROUTE_VERSION` */
internal const val WATCH_ROUTE_VERSION = 1

private const val MICRO_DEGREES = 1_000_000.0

private const val WATCH_ROUTE_HEADER_BYTES = 1 + 2 + 8 + 8

/**
 * @parity /modules/vescape-core/ios/watch/WatchRoute.swift `WATCH_ROUTE_MAX_POINTS`
 * @platform-diff watchOS caps lower (2 000): its channels share one Application Context that is
 */
internal const val WATCH_ROUTE_MAX_POINTS = 8_000

/** @parity /modules/vescape-core/ios/watch/WatchRoute.swift `WatchGeoPoint` */
internal data class GeoPoint(val lat: Double, val lon: Double)

/**
 * @parity /modules/vescape-core/ios/watch/WatchRoute.swift `WatchRouteCodec`
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

    private fun simplify(points: List<GeoPoint>, limit: Int): List<GeoPoint> {
        val stride = (points.size - 1).toDouble() / (limit - 1)
        return (0 until limit).map { points[(it * stride).roundToInt().coerceAtMost(points.lastIndex)] }
    }
}

private const val METERS_PER_DEGREE_LAT = 110_574.0
private const val METERS_PER_DEGREE_LON_EQUATOR = 111_320.0

/**
 * @parity /modules/vescape-core/ios/watch/WatchRoute.swift `watchOffsetMeters`
 */
internal fun offsetMeters(origin: GeoPoint, point: GeoPoint): Pair<Double, Double> {
    val east = (point.lon - origin.lon) * METERS_PER_DEGREE_LON_EQUATOR * cos(Math.toRadians(origin.lat))
    val north = (point.lat - origin.lat) * METERS_PER_DEGREE_LAT
    return east to north
}
