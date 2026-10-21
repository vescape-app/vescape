package expo.modules.vescapecore.location

import kotlin.math.abs
import kotlin.math.asin
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.sin

/** Display-only GPS correction plus bounded dead reckoning, epoch ms for transport to another device.
 * @parity /modules/vescape-core/ios/location/GpsDisplaySmoother.swift `GpsDisplayMotion`
 * @parity /modules/vescape-core/src/index.ts `GpsDisplayMotion`
 */
data class GpsDisplayMotion(
    val fromLatitude: Double,
    val fromLongitude: Double,
    val toLatitude: Double,
    val toLongitude: Double,
    val startsAtMs: Long,
    val endsAtMs: Long,
    val resetPosition: Boolean = false,
    val latitudePerMs: Double = 0.0,
    val longitudePerMs: Double = 0.0,
    val velocityExpiresAtMs: Long = 0,
) {
    /** @parity /src/modules/map/lib/gpsDisplayMotion.ts `gpsDisplayPosition` */
    fun positionAt(now: Long): Pair<Double, Double> {
        val t = if (endsAtMs > startsAtMs) ((now - startsAtMs).toDouble() / (endsAtMs - startsAtMs)).coerceIn(0.0, 1.0) else 1.0
        val elapsed = (minOf(now, velocityExpiresAtMs) - startsAtMs).coerceAtLeast(0).toDouble()
        return Pair(fromLatitude + (toLatitude - fromLatitude) * t + latitudePerMs * elapsed,
            (fromLongitude + longitudeDelta(fromLongitude, toLongitude) * t + longitudePerMs * elapsed + 540) % 360 - 180)
    }
    fun toMap(): Map<String, Any> = mapOf(
        "fromLatitude" to fromLatitude, "fromLongitude" to fromLongitude,
        "toLatitude" to toLatitude, "toLongitude" to toLongitude,
        "startsAtMs" to startsAtMs, "endsAtMs" to endsAtMs,
        "resetPosition" to resetPosition, "latitudePerMs" to latitudePerMs, "longitudePerMs" to longitudePerMs, "velocityExpiresAtMs" to velocityExpiresAtMs,
    )
    companion object {
        const val MIN_CORRECTION_MS = 100L
        fun longitudeDelta(from: Double, to: Double): Double = (to - from + 540.0) % 360.0 - 180.0
    }
}

/** Display estimates never mutate measured fixes. GPS corrections and telemetry velocity updates have independent clocks.
 * @parity /modules/vescape-core/ios/location/GpsDisplaySmoother.swift `GpsDisplaySmoother`
 */
/** @parity /modules/vescape-core/src/index.ts `GpsDisplaySettings`
 * @parity /src/modules/map/store/gpsDisplayStore.ts `defaults`
 */
class GpsDisplaySmoother(var smoothingPercent: Double = 100.0, var predictionPercent: Double = 50.0) {
    var motion: GpsDisplayMotion? = null
        private set
    /** @parity /src/modules/map/components/GpsDisplayControls.tsx `GpsDisplayControls` */
    fun configure(smoothingPercent: Double, predictionPercent: Double, now: Long): GpsDisplayMotion? {
        if (!smoothingPercent.isFinite() || !predictionPercent.isFinite()) return motion
        val smoothing = smoothingPercent.coerceIn(0.0, 200.0)
        val prediction = predictionPercent.coerceIn(0.0, 100.0)
        if (smoothing == this.smoothingPercent && prediction == this.predictionPercent) return motion
        this.smoothingPercent = smoothing
        this.predictionPercent = prediction
        updateSpeed(latestSpeed, latestSpeedAt, now)
        if (smoothing == 0.0) {
            motion = motion?.let { it.copy(toLatitude = it.fromLatitude, toLongitude = it.fromLongitude, endsAtMs = now) }
        } else if (smoothing > 0 && (motion?.endsAtMs ?: 0) > now) {
            motion = motion?.copy(endsAtMs = now + maxOf(GpsDisplayMotion.MIN_CORRECTION_MS, (cadenceMs * smoothing / 100).toLong()))
        }
        return motion
    }
    private var lastTimestamp: Long? = null
    private val intervals = ArrayDeque<Long>()
    private var cadenceMs = 1_000L

    fun reset() {
        motion = null
        previousFix = null
        direction = null
        latestGpsAt = 0
        lastTimestamp = null
        cadenceMs = 1_000L
        intervals.clear()
    }

    /** Accurate fixes <= 2s old; cadence 100ms...5s. Poor fixes hold, gaps reset cadence.
     * Prediction uses the last two accurate positions and board speed fresh within one second.
     */
    fun update(latitude: Double, longitude: Double, timestamp: Long, precise: Boolean,
        accuracyM: Double?, gpsSpeedMps: Double?, courseDeg: Double?, courseTimestamp: Long?,
        boardSpeedMps: Double?, boardSpeedTimestamp: Long?, now: Long): GpsDisplayMotion? {
        if (!latitude.isFinite() || !longitude.isFinite() || abs(latitude) > 90 || abs(longitude) > 180 ||
            timestamp > now + 250 || lastTimestamp?.let { timestamp <= it } == true) return motion
        if (!precise || accuracyM == null || !accuracyM.isFinite() || accuracyM < 0 || accuracyM > 25 || now - timestamp > 2_000) {
            intervals.clear()
            lastTimestamp = timestamp
            return motion
        }
        lastTimestamp?.let { previous ->
            val interval = timestamp - previous
            if (interval in 100..5_000) {
                intervals.addLast(interval)
                if (intervals.size > 3) intervals.removeFirst()
            } else if (interval > 5_000) intervals.clear()
        }
        previousFix?.let { previous ->
            val dy = Math.toRadians(latitude - previous.first) * 6_371_000
            val dx = Math.toRadians(GpsDisplayMotion.longitudeDelta(previous.second, longitude)) * 6_371_000 * cos(Math.toRadians(latitude))
            val distance = kotlin.math.hypot(dx, dy)
            if (distance >= 0.5) direction = Pair((latitude - previous.first) / distance,
                GpsDisplayMotion.longitudeDelta(previous.second, longitude) / distance)
        }
        previousFix = Pair(latitude, longitude)
        latestGpsAt = timestamp
        lastTimestamp = timestamp
        val cadence = if (intervals.isEmpty()) 1_000L else intervals.sum() / intervals.size
        cadenceMs = cadence
        return retarget(latitude, longitude, timestamp, gpsSpeedMps, courseDeg,
            courseTimestamp, boardSpeedMps, boardSpeedTimestamp, cadence, now)
    }

    private fun retarget(latitude: Double, longitude: Double, timestamp: Long, gpsSpeedMps: Double?,
        courseDeg: Double?, courseTimestamp: Long?, boardSpeedMps: Double?, boardSpeedTimestamp: Long?,
        cadence: Long, now: Long): GpsDisplayMotion? {
        val from = motion?.positionAt(now) ?: Pair(latitude, longitude)
        val duration = if (motion == null || smoothingPercent == 0.0) 0L else maxOf(GpsDisplayMotion.MIN_CORRECTION_MS, (cadence * smoothingPercent / 100).toLong())
        motion = GpsDisplayMotion(if (duration == 0L) latitude else from.first,
            if (duration == 0L) longitude else from.second, latitude, longitude, now, now + duration)
        updateSpeed(boardSpeedMps, boardSpeedTimestamp, now)
        motion = motion?.copy(resetPosition = duration == 0L)
        return motion
    }
    private var previousFix: Pair<Double, Double>? = null
    private var direction: Pair<Double, Double>? = null
    private var latestGpsAt = 0L
    private var latestSpeed: Double? = null
    private var latestSpeedAt: Long? = null

    /** Telemetry updates rebase velocity without restarting unfinished GPS correction. */
    fun updateSpeed(speedMps: Double?, timestamp: Long?, now: Long): GpsDisplayMotion? {
        latestSpeed = speedMps
        latestSpeedAt = timestamp
        val old = motion ?: return null
        val current = old.positionAt(now)
        val remaining = if (old.endsAtMs > now && old.endsAtMs > old.startsAtMs)
            (old.endsAtMs - now).toDouble() / (old.endsAtMs - old.startsAtMs) else 0.0
        val speed = speedMps?.takeIf { it.isFinite() && it >= 0 }?.coerceAtMost(60.0) ?: 0.0
        val expires = minOf(latestGpsAt + 5_000, (timestamp ?: 0) + 1_000)
        val strength = if (expires > now) speed * predictionPercent / 100 / 1_000 else 0.0
        motion = GpsDisplayMotion(current.first, current.second,
            current.first + (old.toLatitude - old.fromLatitude) * remaining,
            (current.second + GpsDisplayMotion.longitudeDelta(old.fromLongitude, old.toLongitude) * remaining + 540) % 360 - 180,
            now, maxOf(now, old.endsAtMs), false, (direction?.first ?: 0.0) * strength,
            (direction?.second ?: 0.0) * strength, maxOf(now, expires))
        return motion
    }
}
