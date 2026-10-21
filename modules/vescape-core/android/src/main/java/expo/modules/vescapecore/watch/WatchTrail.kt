package expo.modules.vescapecore.watch

import expo.modules.vescapecore.location.GpsDisplayMotion
import java.nio.ByteBuffer
import java.nio.ByteOrder

/** A precise recent phone fix, in metres from the current Rider, independent of Navigation.
 * @parity /modules/vescape-core/ios/watch/WatchTrail.swift
 */
data class WatchTrailPoint(val eastM: Double, val northM: Double)

/** Absolute display anchor for map motion, independent of the route origin and history retention.
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

data class WatchTrailSnapshot(val points: List<WatchTrailPoint> = emptyList(), val position: WatchMapPosition? = null, val displayMotion: GpsDisplayMotion? = null)

/** Bounded snapshot appended after the fixed Watch Frame lanes. Older wrists ignore these bytes.
 * Header: ASCII TR, version 2, count, Float64 rider latitude/longitude (NaN if absent), followed by
 * little-endian Float32 east/north pairs. Missing/unknown/malformed leaves telemetry readable.
 * @parity /modules/vescape-core/ios/watch/WatchTrail.swift `WatchTrailCodec`
 */
object WatchTrailCodec {
    const val MAX_POINTS = 120

    fun encode(points: List<WatchTrailPoint>, position: WatchMapPosition? = null, displayMotion: GpsDisplayMotion? = null): ByteArray {
        require(points.size <= MAX_POINTS)
        return ByteBuffer.allocate(20 + points.size * 8 + if (displayMotion == null) 0 else 80).order(ByteOrder.LITTLE_ENDIAN).apply {
            put(84.toByte())
            put(82.toByte())
            put((if (displayMotion == null) 2 else 4).toByte())
            put(points.size.toByte())
            putDouble(position?.latitude ?: Double.NaN)
            putDouble(position?.longitude ?: Double.NaN)
            points.forEach {
                putFloat(it.eastM.toFloat())
                putFloat(it.northM.toFloat())
            }
            displayMotion?.let { motion ->
                listOf(motion.fromLatitude, motion.fromLongitude, motion.toLatitude, motion.toLongitude,
                    motion.startsAtMs.toDouble(), motion.endsAtMs.toDouble(), motion.latitudePerMs, motion.longitudePerMs,
                    motion.velocityExpiresAtMs.toDouble(), if (motion.resetPosition) 1.0 else 0.0).forEach { putDouble(it) }
            }
        }.array()
    }

    fun decode(bytes: ByteArray, offset: Int): WatchTrailSnapshot {
        val empty = WatchTrailSnapshot()
        if (offset < 0 || bytes.size - offset < 20) return empty
        val buffer = ByteBuffer.wrap(bytes, offset, bytes.size - offset).order(ByteOrder.LITTLE_ENDIAN)
        if (buffer.get().toInt() != 84 || buffer.get().toInt() != 82) return empty
        val version = buffer.get().toInt()
        if (version !in 2..4) return empty
        val count = buffer.get().toInt() and 0xff
        val latitude = buffer.double
        val longitude = buffer.double
        val position = if (latitude.isNaN() && longitude.isNaN()) null else {
            if (latitude !in -90.0..90.0 || longitude !in -180.0..180.0) return empty
            WatchMapPosition(latitude, longitude)
        }
        if (count > MAX_POINTS || buffer.remaining() != count * 8 + if (version == 4) 80 else if (version == 3) 48 else 0) return empty
        val points = List(count) { WatchTrailPoint(buffer.float.toDouble(), buffer.float.toDouble()) }
        if (points.any { !it.eastM.isFinite() || !it.northM.isFinite() }) return empty
        val motion = if (version >= 3) {
            val v = List(if (version == 4) 10 else 6) { buffer.double }
            if (v.all { it.isFinite() } && kotlin.math.abs(v[0]) <= 90 && kotlin.math.abs(v[1]) <= 180 &&
                kotlin.math.abs(v[2]) <= 90 && kotlin.math.abs(v[3]) <= 180 && v[4] >= 0 &&
                v[5] >= v[4] && v[5] - v[4] <= 10_000 && v[5] < Long.MAX_VALUE.toDouble() &&
                (version == 3 || (v[8] >= 0 && v[8] < Long.MAX_VALUE.toDouble() && v[8] <= v[4] + 5_000 && v[9] in listOf(0.0, 1.0)))) {
                GpsDisplayMotion(v[0], v[1], v[2], v[3], v[4].toLong(), v[5].toLong(),
                    if (version == 4) v[9] == 1.0 else false, if (version == 4) v[6] else 0.0,
                    if (version == 4) v[7] else 0.0, if (version == 4) v[8].toLong() else 0)
            } else null
        } else null
        return WatchTrailSnapshot(points, position, motion)
    }
}
