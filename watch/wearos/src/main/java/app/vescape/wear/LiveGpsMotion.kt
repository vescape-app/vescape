package app.vescape.wear

import kotlin.math.*

/** Renderer-local display state. Never put this on the phone or the wire.
 * @parity /src/modules/map/lib/liveMotion/config.ts
 * @parity /src/modules/map/lib/liveMotion/motion.ts
 * @parity /modules/vescape-core/ios/watch/LiveGpsMotion.swift
 */
internal data class MotionConfig(
    val predictionStrength: Double = 0.5, val pointWindow: Int = 2, val cameraWindow: Int = 3,
    val movementM: Double = 2.0, val accuracyMovementRatio: Double = 0.3, val fullConfidenceM: Double = 6.0,
    val goodAccuracyM: Double = 5.0, val maxAccuracyM: Double = 25.0, val gpsFreshnessS: Double = 3.0,
    val directionWindowS: Double = 8.0, val telemetryFreshnessS: Double = 1.0, val directionRetentionS: Double = 2.0, val predictionHorizonS: Double = 1.5,
    val maxPredictionM: Double = 8.0, val recoveryAfterS: Double = 3.0, val recoverySpeedMps: Double = 2.0,
    val cameraPositionOmega: Double = 3.0, val cameraHeadingOmega: Double = 3.0, val arrowHeadingOmega: Double = 10.0,
) {
    companion object {
        fun fromJson(json: String): MotionConfig {
            val values = try { org.json.JSONObject(json) } catch (_: Exception) { org.json.JSONObject() }
            fun read(key: String, fallback: Double, min: Double, max: Double): Double =
                values.optDouble(key, fallback).takeIf { it.isFinite() }?.coerceIn(min, max) ?: fallback
            val defaults = MotionConfig()
            return MotionConfig(
                predictionStrength = read("predictionStrength", defaults.predictionStrength, 0.0, 1.0),
                pointWindow = read("pointWindow", defaults.pointWindow.toDouble(), 2.0, 6.0).roundToInt(),
                cameraWindow = read("cameraWindow", defaults.cameraWindow.toDouble(), 2.0, 6.0).roundToInt(),
                movementM = read("movementM", defaults.movementM, 0.5, 10.0),
                accuracyMovementRatio = read("accuracyMovementRatio", defaults.accuracyMovementRatio, 0.1, 1.0),
                fullConfidenceM = read("fullConfidenceM", defaults.fullConfidenceM, 2.0, 20.0),
                goodAccuracyM = read("goodAccuracyM", defaults.goodAccuracyM, 1.0, 10.0),
                maxAccuracyM = read("maxAccuracyM", defaults.maxAccuracyM, 11.0, 50.0),
                gpsFreshnessS = read("gpsFreshnessS", defaults.gpsFreshnessS, 0.5, 10.0),
                telemetryFreshnessS = read("telemetryFreshnessS", defaults.telemetryFreshnessS, 0.25, 3.0),
                directionWindowS = read("directionWindowS", defaults.directionWindowS, 3.0, 20.0),
                directionRetentionS = read("directionRetentionS", defaults.directionRetentionS, 0.5, 5.0),
                predictionHorizonS = read("predictionHorizonS", defaults.predictionHorizonS, 0.25, 3.0),
                maxPredictionM = read("maxPredictionM", defaults.maxPredictionM, 1.0, 15.0),
                recoveryAfterS = read("recoveryAfterS", defaults.recoveryAfterS, 1.0, 6.0),
                recoverySpeedMps = read("recoverySpeedMps", defaults.recoverySpeedMps, 0.5, 5.0),
                cameraPositionOmega = read("cameraPositionOmega", defaults.cameraPositionOmega, 1.0, 10.0),
                cameraHeadingOmega = read("cameraHeadingOmega", defaults.cameraHeadingOmega, 1.0, 10.0),
                arrowHeadingOmega = read("arrowHeadingOmega", defaults.arrowHeadingOmega, 2.0, 20.0),
            )
        }
    }
}
internal data class MotionFix(val longitude: Double, val latitude: Double, val timestamp: Double, val accuracyM: Double?)
internal data class MotionVector(val x: Double = 0.0, val y: Double = 0.0) {
    operator fun plus(b: MotionVector) = MotionVector(x + b.x, y + b.y)
    operator fun times(n: Double) = MotionVector(x * n, y * n)
    fun dot(b: MotionVector) = x * b.x + y * b.y
    val length get() = hypot(x, y)
}
internal data class MotionDirection(val unit: MotionVector, val confidence: Double, val at: Double)
private data class DirectionPoint(val p: MotionVector, val at: Double, val accuracy: Double)
internal class TravelDirection {
    private var points = mutableListOf<DirectionPoint>()
    private var last: MotionDirection? = null
    fun reset() { points.clear(); last = null }
    fun update(p: MotionVector, accuracy: Double, now: Double, window: Int, config: MotionConfig) {
        points.removeAll { now - it.at > config.directionWindowS * 1000 }
        val previous = points.lastOrNull()
        if (previous == null) { points.add(DirectionPoint(p, now, accuracy)); return }
        val displacement = p + previous.p * -1.0
        val distance = displacement.length
        val minimum = max(config.movementM, max(accuracy, previous.accuracy) * config.accuracyMovementRatio)
        if (distance < minimum) return
        if (last != null && displacement.dot(last!!.unit) < 0 && distance < max(minimum, accuracy + previous.accuracy)) return
        points.add(DirectionPoint(p, now, accuracy)); points = points.takeLast(window).toMutableList()
        val across = p + points.first().p * -1.0
        val direction = if (across.dot(displacement) > 0 && across.length >= minimum) across else displacement
        last = MotionDirection(direction * (1 / direction.length), min(1.0, distance / max(minimum, config.fullConfidenceM)), now)
    }
    fun read(now: Double, config: MotionConfig) = last?.takeIf { now - it.at < config.directionRetentionS * 1000 }
}
internal class LiveGpsMotion {
    var config = MotionConfig(); private set
    private var origin: MotionFix? = null
    private var fix: MotionFix? = null
    private var p = MotionVector()
    private var time = 0.0
    private var correction = MotionVector()
    private var correctionEnd = 0.0
    private var speed = 0.0
    private var speedAt = Double.NEGATIVE_INFINITY
    private var speedRevision = Double.NEGATIVE_INFINITY
    private var fixAt = Double.NEGATIVE_INFINITY
    private var source = 0.0
    private var resetAt = Double.NEGATIVE_INFINITY
    private val intervals = mutableListOf<Double>()
    private val pointDirection = TravelDirection()
    private val cameraDirection = TravelDirection()
    private var heldHeading: Double? = null
    private var contradictionAt: Double? = null
    private var contradictionCount = 0
    private var contradictionFix: MotionVector? = null
    private var predictedM = 0.0
    private var gpsUsable = true
    var recovering = false; private set
    private var brakingAxis: MotionVector? = null
    var cadenceMs = 1000.0; private set
    fun reset(source: Double, now: Double) {
        if (source < this.source) return
        this.source = source; resetAt = now; time = now
        origin = null; fix = null; p = MotionVector(); correction = MotionVector(); correctionEnd = now
        speed = 0.0; speedAt = Double.NEGATIVE_INFINITY; speedRevision = Double.NEGATIVE_INFINITY; fixAt = Double.NEGATIVE_INFINITY
        intervals.clear(); cadenceMs = 1000.0; pointDirection.reset(); cameraDirection.reset(); heldHeading = null
        contradictionAt = null; contradictionCount = 0; contradictionFix = null; predictedM = 0.0; recovering = false; brakingAxis = null; gpsUsable = true
    }
    fun configure(config: MotionConfig, now: Double) { advance(now); this.config = config }
    fun updateSpeed(mps: Double?, revision: Double, receivedAt: Double, source: Double, ageMs: Double = 0.0): Boolean {
        if (source != this.source || receivedAt < resetAt || revision <= speedRevision) return false
        advance(receivedAt); speedRevision = revision; speed = mps?.takeIf { it.isFinite() }?.let { abs(it) } ?: 0.0
        speedAt = receivedAt - max(0.0, ageMs); return true
    }
    fun accept(fix: MotionFix, receivedAt: Double, ageMs: Double, source: Double): Boolean {
        val accuracy = fix.accuracyM
        if (source == this.source && receivedAt >= resetAt && (this.fix == null || fix.timestamp > this.fix!!.timestamp) &&
            (accuracy == null || !accuracy.isFinite() || accuracy > config.maxAccuracyM)) { advance(receivedAt); gpsUsable = false }
        if (source != this.source || receivedAt < resetAt || !fix.timestamp.isFinite() || !fix.longitude.isFinite() || !fix.latitude.isFinite() ||
            abs(fix.latitude) > 85 || abs(fix.longitude) > 180 || accuracy == null || !accuracy.isFinite() || accuracy < 0 || accuracy > config.maxAccuracyM ||
            !ageMs.isFinite() || ageMs < 0 || ageMs >= config.gpsFreshnessS * 1000 || (this.fix != null && fix.timestamp <= this.fix!!.timestamp)) return false
        advance(receivedAt)
        val previous = this.fix
        val interval = previous?.let { fix.timestamp - it.timestamp } ?: 0.0
        val gap = previous != null && interval > config.gpsFreshnessS * 1000
        if (interval > 0 && !gap) {
            intervals.add(interval); while (intervals.size > 5) intervals.removeAt(0)
            cadenceMs = intervals.sorted()[intervals.size / 2].coerceIn(100.0, 3000.0)
        }
        if (gap) { pointDirection.reset(); cameraDirection.reset(); intervals.clear(); brakingAxis = null; contradictionAt = null; contradictionCount = 0; contradictionFix = null; cadenceMs = 1000.0 }
        if (origin == null) { origin = fix; p = MotionVector() }
        val measured = toMeters(fix)
        this.fix = fix; gpsUsable = true; fixAt = receivedAt - ageMs; predictedM = 0.0
        pointDirection.update(measured, accuracy, fixAt, config.pointWindow, config)
        cameraDirection.update(measured, accuracy, fixAt, config.cameraWindow, config)
        val direction = pointDirection.read(receivedAt, config)
        if (direction != null) brakingAxis = direction.unit
        val error = measured + p * -1.0
        val axis = direction?.unit ?: brakingAxis
        val behind = axis != null && error.dot(axis) < -0.25
        val consistent = contradictionFix?.let { (measured + it * -1.0).length <= max(1.0, accuracy * 0.5) } ?: false
        if (behind) {
            if (consistent) contradictionCount++ else { contradictionAt = receivedAt; contradictionCount = 1 }
            contradictionFix = measured
        } else { contradictionAt = null; contradictionCount = 0; contradictionFix = null }
        recovering = contradictionAt?.let { (accuracy <= config.goodAccuracyM || contradictionCount >= 3) && receivedAt - it >= config.recoveryAfterS * 1000 } ?: false
        correction = error * (1000 / cadenceMs)
        val recoverySpeed = config.recoverySpeedMps * max(0.2, ((config.maxAccuracyM - accuracy) / (config.maxAccuracyM - config.goodAccuracyM)).coerceIn(0.0, 1.0))
        if (recovering && correction.length > recoverySpeed) correction = correction * (recoverySpeed / correction.length)
        correctionEnd = receivedAt + if (recovering) max(cadenceMs, error.length / recoverySpeed * 1000) else cadenceMs
        if (previous == null) { p = measured; correction = MotionVector() }
        return true
    }
    private fun toMeters(fix: MotionFix): MotionVector {
        val o = origin!!
        return MotionVector((((fix.longitude - o.longitude + 540) % 360) - 180) * 111320 * cos(o.latitude * PI / 180), (fix.latitude - o.latitude) * 110574)
    }
    private fun coordinate(p: MotionVector): Pair<Double, Double>? {
        val o = origin ?: return null
        return Pair(((o.longitude + p.x / (111320 * cos(o.latitude * PI / 180)) + 540) % 360) - 180, o.latitude + p.y / 110574)
    }
    private data class Prediction(val direction: MotionDirection?, val confidence: Double, val deadline: Double, val velocity: MotionVector)
    private fun prediction(now: Double, predicted: Double = predictedM): Prediction {
        val direction = pointDirection.read(now, config)
        val accuracy = fix?.accuracyM ?: Double.POSITIVE_INFINITY
        val quality = ((config.maxAccuracyM - accuracy) / (config.maxAccuracyM - config.goodAccuracyM)).coerceIn(0.0, 1.0)
        val deadline = minOf(fixAt + min(config.gpsFreshnessS, config.predictionHorizonS) * 1000,
            speedAt + config.telemetryFreshnessS * 1000, (direction?.at ?: Double.NEGATIVE_INFINITY) + config.directionRetentionS * 1000)
        val confidence = quality * (direction?.confidence ?: 0.0)
        val enabled = now < deadline && predicted < config.maxPredictionM - 1e-9 && !recovering && gpsUsable
        return Prediction(direction, confidence, deadline, if (enabled && direction != null) direction.unit * (speed * config.predictionStrength * confidence) else MotionVector())
    }
    private fun project(now: Double): Pair<MotionVector, Double> {
        var position = p; var at = time; var predicted = predictedM
        while (at < now) {
            val prediction = prediction(at, predicted); val pv = prediction.velocity
            val predictionEnd = if (pv.length > 0) min(prediction.deadline, at + (config.maxPredictionM - predicted) / pv.length * 1000) else Double.POSITIVE_INFINITY
            val end = minOf(now, if (correctionEnd > at) correctionEnd else Double.POSITIVE_INFINITY, predictionEnd)
            var velocity = (if (at < correctionEnd) correction else MotionVector()) + pv
            val axis = brakingAxis
            if (!recovering && axis != null && velocity.dot(axis) < 0) velocity += axis * -velocity.dot(axis)
            val dt = (end - at) / 1000
            position += velocity * dt; predicted += pv.length * dt
            if (end <= at) break
            at = end
        }
        return Pair(position, predicted)
    }
    private fun advance(now: Double) {
        if (now <= time) return
        pointDirection.read(time, config)?.let { brakingAxis = it.unit }
        val next = project(now); p = next.first; predictedM = next.second; time = now
    }
    fun position(now: Double) = coordinate(project(max(now, time)).first)
    fun cameraHeading(now: Double): Double? {
        cameraDirection.read(now, config)?.let { heldHeading = (atan2(it.unit.x, it.unit.y) * 180 / PI + 360) % 360 }
        return heldHeading
    }
    fun pointHeading(now: Double) = pointDirection.read(now, config)?.let { (atan2(it.unit.x, it.unit.y) * 180 / PI + 360) % 360 }
    fun effectivePrediction(now: Double) = prediction(now).velocity.length / if (speed != 0.0) speed else 1.0
    fun movingUntil(now: Double): Double = max(if (correction.length > 0) correctionEnd else 0.0, prediction(now).let { if (it.velocity.length > 0) it.deadline else 0.0 })
}
