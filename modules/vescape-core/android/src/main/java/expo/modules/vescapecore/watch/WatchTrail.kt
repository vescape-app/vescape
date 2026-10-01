package expo.modules.vescapecore.watch

import java.nio.ByteBuffer
import java.nio.ByteOrder

/** A precise recent phone fix, in metres from the current Rider, independent of Navigation.
 * @parity /modules/vescape-core/ios/watch/WatchTrail.swift
 */
data class WatchTrailPoint(val eastM: Double, val northM: Double)

/** Bounded snapshot appended after the fixed Watch Frame lanes. Older wrists ignore these bytes.
 * Header: ASCII TR, version 1, unsigned point count; then little-endian Float32 east/north pairs.
 * Empty means clear. Missing/unknown/malformed means no trail, while telemetry still decodes.
 * @parity /modules/vescape-core/ios/watch/WatchTrail.swift `WatchTrailCodec`
 */
object WatchTrailCodec {
    const val MAX_POINTS = 120

    fun encode(points: List<WatchTrailPoint>): ByteArray {
        require(points.size <= MAX_POINTS)
        return ByteBuffer.allocate(4 + points.size * 8).order(ByteOrder.LITTLE_ENDIAN).apply {
            put(84.toByte())
            put(82.toByte())
            put(1.toByte())
            put(points.size.toByte())
            points.forEach {
                putFloat(it.eastM.toFloat())
                putFloat(it.northM.toFloat())
            }
        }.array()
    }

    fun decode(bytes: ByteArray, offset: Int): List<WatchTrailPoint> {
        if (offset < 0 || bytes.size - offset < 4) return emptyList()
        val buffer = ByteBuffer.wrap(bytes, offset, bytes.size - offset).order(ByteOrder.LITTLE_ENDIAN)
        if (buffer.get().toInt() != 84 || buffer.get().toInt() != 82 || buffer.get().toInt() != 1) return emptyList()
        val count = buffer.get().toInt() and 0xff
        if (count > MAX_POINTS || buffer.remaining() != count * 8) return emptyList()
        val points = List(count) { WatchTrailPoint(buffer.float.toDouble(), buffer.float.toDouble()) }
        return points.takeIf { it.all { p -> p.eastM.isFinite() && p.northM.isFinite() } } ?: emptyList()
    }
}
