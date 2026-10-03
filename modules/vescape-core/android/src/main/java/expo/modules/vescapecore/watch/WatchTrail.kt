package expo.modules.vescapecore.watch

import java.nio.ByteBuffer
import java.nio.ByteOrder

/** A precise recent phone fix, in metres from the current Rider, independent of Navigation.
 * @parity /modules/vescape-core/ios/watch/WatchTrail.swift
 */
data class WatchTrailPoint(val eastM: Double, val northM: Double)

/** Absolute GPS anchor for map motion, independent of the route origin and history retention.
 * @parity /modules/vescape-core/ios/watch/WatchTrail.swift `WatchMapPosition`
 */
data class WatchMapPosition(val latitude: Double, val longitude: Double) {
    fun offsetFrom(origin: WatchMapPosition): WatchTrailPoint {
        val longitudeDelta = ((longitude - origin.longitude + 540) % 360) - 180
        return WatchTrailPoint(
            longitudeDelta * 111_320.0 * kotlin.math.cos(Math.toRadians(origin.latitude)),
            (latitude - origin.latitude) * 110_574.0,
        )
    }
}

data class WatchTrailSnapshot(val points: List<WatchTrailPoint> = emptyList(), val position: WatchMapPosition? = null)

/** Bounded snapshot appended after the fixed Watch Frame lanes. Older wrists ignore these bytes.
 * Header: ASCII TR, version 2, count, Float64 rider latitude/longitude (NaN if absent), followed by
 * little-endian Float32 east/north pairs. Missing/unknown/malformed leaves telemetry readable.
 * @parity /modules/vescape-core/ios/watch/WatchTrail.swift `WatchTrailCodec`
 */
object WatchTrailCodec {
    const val MAX_POINTS = 120

    fun encode(points: List<WatchTrailPoint>, position: WatchMapPosition? = null): ByteArray {
        require(points.size <= MAX_POINTS)
        return ByteBuffer.allocate(20 + points.size * 8).order(ByteOrder.LITTLE_ENDIAN).apply {
            put(84.toByte())
            put(82.toByte())
            put(2.toByte())
            put(points.size.toByte())
            putDouble(position?.latitude ?: Double.NaN)
            putDouble(position?.longitude ?: Double.NaN)
            points.forEach {
                putFloat(it.eastM.toFloat())
                putFloat(it.northM.toFloat())
            }
        }.array()
    }

    fun decode(bytes: ByteArray, offset: Int): WatchTrailSnapshot {
        val empty = WatchTrailSnapshot()
        if (offset < 0 || bytes.size - offset < 20) return empty
        val buffer = ByteBuffer.wrap(bytes, offset, bytes.size - offset).order(ByteOrder.LITTLE_ENDIAN)
        if (buffer.get().toInt() != 84 || buffer.get().toInt() != 82 || buffer.get().toInt() != 2) return empty
        val count = buffer.get().toInt() and 0xff
        val latitude = buffer.double
        val longitude = buffer.double
        val position = if (latitude.isNaN() && longitude.isNaN()) null else {
            if (latitude !in -90.0..90.0 || longitude !in -180.0..180.0) return empty
            WatchMapPosition(latitude, longitude)
        }
        if (count > MAX_POINTS || buffer.remaining() != count * 8) return empty
        val points = List(count) { WatchTrailPoint(buffer.float.toDouble(), buffer.float.toDouble()) }
        if (points.any { !it.eastM.isFinite() || !it.northM.isFinite() }) return empty
        return WatchTrailSnapshot(points, position)
    }
}
