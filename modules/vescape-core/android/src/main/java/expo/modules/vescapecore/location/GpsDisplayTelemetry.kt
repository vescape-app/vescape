package expo.modules.vescapecore.location

import kotlin.math.abs

/**
 * Shared Board-speed input for GPS fixes and live ticks, independent of the Board protocol.
 * @parity /modules/vescape-core/ios/connection/BoardSessionController.swift `emitTelemetry`
 */
internal class GpsDisplayTelemetry(private val smoother: GpsDisplaySmoother) {
    var speedSample: Pair<Double?, Long?> = Pair(null, null)
        private set
    private var lastPublishedAt = 0L
    private var lastPublishedSpeed = -1.0

    fun update(speedKmh: Double?, timestamp: Long?, now: Long, clockSpeed: Double = 1.0): Map<String, Any?> {
        val speed = speedKmh?.takeIf { it.isFinite() }?.let { abs(it) / 3.6 * clockSpeed }
        speedSample = Pair(speed, timestamp)
        val motion = smoother.updateSpeed(speed, timestamp, now)
        val publishedSpeed = speed ?: -1.0
        if (abs(publishedSpeed - lastPublishedSpeed) < 0.1 && now - lastPublishedAt < 500) return emptyMap()
        lastPublishedAt = now
        lastPublishedSpeed = publishedSpeed
        return mapOf("displayMotion" to motion?.toMap())
    }

    fun clear(now: Long) {
        speedSample = Pair(null, null)
        smoother.updateSpeed(null, null, now)
        lastPublishedAt = 0L
        lastPublishedSpeed = -1.0
    }
}
