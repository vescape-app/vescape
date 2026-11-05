package expo.modules.vescapecore.display

import kotlin.math.*

/** Surface-local display state. Phone and watch compile this same source.
 * @parity /modules/vescape-core/src/mapDisplay.ts `MotionConfig`
 * @parity /modules/vescape-core/ios/watch/LiveGpsMotion.swift
 */
internal data class MotionConfig(
    val predictionStrength: Double = 0.5,
    val pointWindow: Int = 2,
    val cameraWindow: Int = 3,
    val movementM: Double = 2.0,
    val accuracyMovementRatio: Double = 0.3,
    val fullConfidenceM: Double = 6.0,
    val goodAccuracyM: Double = 5.0,
    val maxAccuracyM: Double = 25.0,
    val gpsFreshnessS: Double = 3.0,
    val directionWindowS: Double = 8.0,
    val cameraConfirmM: Double = 3.0,
    val cameraReverseConfirmM: Double = 8.0,
    val cameraConfirmFixes: Double = 2.0,
    val cameraReverseConfirmFixes: Double = 4.0,
    val telemetryFreshnessS: Double = 1.0,
    val directionRetentionS: Double = 2.0,
    val predictionHorizonS: Double = 1.5,
    val maxPredictionM: Double = 8.0,
    val recoveryAfterS: Double = 3.0,
    val recoverySpeedMps: Double = 2.0,
    val cameraPositionOmega: Double = 3.0,
    val cameraHeadingOmega: Double = 1.0,
    val arrowHeadingOmega: Double = 10.0,
) {
    fun values(): Map<String, Double> = mapOf(
        "predictionStrength" to predictionStrength,
        "maxPredictionM" to maxPredictionM,
        "movementM" to movementM,
        "cameraConfirmM" to cameraConfirmM,
        "cameraPositionOmega" to cameraPositionOmega,
        "cameraHeadingOmega" to cameraHeadingOmega,
        "arrowHeadingOmega" to arrowHeadingOmega
    )
    companion object {
        fun controls(): Map<String, Map<String, Any>> {
            val defaults = MotionConfig().values()
            return mapOf(
                "predictionStrength" to mapOf("value" to defaults.getValue("predictionStrength"), "min" to 0.0, "max" to 1.0, "step" to 0.05, "unit" to "fraction"),
                "maxPredictionM" to mapOf("value" to defaults.getValue("maxPredictionM"), "min" to 1.0, "max" to 15.0, "step" to 1.0, "unit" to "m"),
                "movementM" to mapOf("value" to defaults.getValue("movementM"), "min" to 0.5, "max" to 10.0, "step" to 0.5, "unit" to "m"),
                "cameraConfirmM" to mapOf("value" to defaults.getValue("cameraConfirmM"), "min" to 1.0, "max" to 10.0, "step" to 0.5, "unit" to "m"),
                "cameraPositionOmega" to mapOf("value" to defaults.getValue("cameraPositionOmega"), "min" to 1.0, "max" to 10.0, "step" to 0.5, "unit" to "rad/s"),
                "cameraHeadingOmega" to mapOf("value" to defaults.getValue("cameraHeadingOmega"), "min" to 0.1, "max" to 10.0, "step" to 0.1, "unit" to "rad/s"),
                "arrowHeadingOmega" to mapOf("value" to defaults.getValue("arrowHeadingOmega"), "min" to 2.0, "max" to 20.0, "step" to 1.0, "unit" to "rad/s")
            )
        }

        fun fromJson(json: String): MotionConfig {
            val values = try { org.json.JSONObject(json) } catch (_: Exception) { org.json.JSONObject() }
            val metadata = controls()
            fun read(key: String): Double {
                val control = metadata.getValue(key)
                val fallback = control.getValue("value") as Double
                return values.optDouble(key, fallback).takeIf { it.isFinite() }
                    ?.coerceIn(control.getValue("min") as Double, control.getValue("max") as Double) ?: fallback
            }
            return MotionConfig(
                predictionStrength = read("predictionStrength"),
                movementM = read("movementM"),
                cameraConfirmM = read("cameraConfirmM"),
                maxPredictionM = read("maxPredictionM"),
                cameraPositionOmega = read("cameraPositionOmega"),
                cameraHeadingOmega = read("cameraHeadingOmega"),
                arrowHeadingOmega = read("arrowHeadingOmega"),
            )
        }
    }
}
/** @parity /modules/vescape-core/src/mapDisplay.ts `MotionFix`
 * @parity /modules/vescape-core/ios/watch/LiveGpsMotion.swift `MotionFix`
 */
internal data class MotionFix(val longitude: Double,
    val latitude: Double,
    val timestamp: Double,
    val accuracyM: Double?)
internal data class MotionVector(val x: Double = 0.0,
    val y: Double = 0.0) {
    operator fun plus(b: MotionVector) = MotionVector(x + b.x, y + b.y)
    operator fun times(n: Double) = MotionVector(x * n, y * n)
    fun dot(b: MotionVector) = x * b.x + y * b.y
    val length get() = hypot(x, y)
}
internal data class MotionDirection(val unit: MotionVector,
    val confidence: Double,
    val at: Double)
private data class DirectionPoint(val p: MotionVector,
    val at: Double,
    val accuracy: Double)
internal class TravelDirection {
    private var points = mutableListOf<DirectionPoint>()
    private var last: MotionDirection? = null
    fun reset() {
        points.clear()
        last = null
    }
    fun update(p: MotionVector, accuracy: Double, now: Double, window: Int, config: MotionConfig) {
        points.removeAll { now - it.at > config.directionWindowS * 1000 }
        val previous = points.lastOrNull()
        if (previous == null) {
            points.add(DirectionPoint(p, now, accuracy))
            return
        }
        val displacement = p + previous.p * -1.0
        val distance = displacement.length
        val minimum = max(config.movementM, max(accuracy, previous.accuracy) * config.accuracyMovementRatio)
        // Meter thresholds tolerate coordinate projection roundoff (one micrometre).
        if (distance + 1e-6 < minimum) return
        if (last != null && now - last!!.at < config.directionRetentionS * 1000 && displacement.dot(last!!.unit) < 0 && distance < max(minimum, accuracy + previous.accuracy)) return
        points.add(DirectionPoint(p, now, accuracy))
        points = points.takeLast(window).toMutableList()
        val across = p + points.first().p * -1.0
        val direction = if (across.dot(displacement) > 0 && across.length >= minimum) across else displacement
        last = MotionDirection(direction * (1 / direction.length), min(1.0, distance / max(minimum, config.fullConfidenceM)), now)
    }
    fun read(now: Double, config: MotionConfig) = last?.takeIf { now - it.at < config.directionRetentionS * 1000 }
}
/** Retains confirmed heading. Brief backwards creeping never flips the camera immediately. */
internal class CameraHeadingConfirmer {
    private val cameraDirection = TravelDirection()
    private var heldHeading: Double? = null
    private var cameraAnchor: MotionVector? = null
    private var cameraLastPosition: MotionVector? = null
    private var cameraCandidate: MotionVector? = null
    private var cameraCandidateFixes = 0
    fun reset() {
        cameraDirection.reset()
        cameraAnchor = null
        cameraLastPosition = null
        cameraCandidate = null
        cameraCandidateFixes = 0
    }
    fun read(): Double? = heldHeading
    fun update(p: MotionVector, accuracy: Double, fixAt: Double, config: MotionConfig) {
        cameraDirection.update(p, accuracy, fixAt, config.cameraWindow, config)
        val anchor = cameraAnchor
        if (anchor == null) {
            cameraAnchor = p
            cameraLastPosition = p
            return
        }
        // Count only newly accepted spatial evidence, never a retained direction at a stationary fix.
        val direction = cameraDirection.read(fixAt, config)?.takeIf { it.at == fixAt } ?: return
        val minimum = max(config.movementM, accuracy * config.accuracyMovementRatio)
        val previous = cameraLastPosition
        val candidate = cameraCandidate
        if (candidate != null && previous != null) {
            val step = p + previous * -1.0
            if (step.length >= minimum && step.dot(candidate) < 0) {
                cameraCandidate = null
                cameraCandidateFixes = 0
            }
        }
        cameraLastPosition = p
        val delta = p + anchor * -1.0
        val distance = delta.length
        // Meter thresholds tolerate coordinate projection roundoff (one micrometre).
        if (distance + 1e-6 < minimum) return
        if (heldHeading == null) {
            heldHeading = (atan2(direction.unit.x, direction.unit.y) * 180 / PI + 360) % 360
            cameraAnchor = p
            return
        }
        if (cameraCandidate != null && delta.dot(cameraCandidate!!) < 0 && distance > minimum * 1.5) {
            cameraAnchor = p
            cameraCandidate = null
            cameraCandidateFixes = 0
            return
        }
        cameraCandidate = delta * (1 / distance)
        cameraCandidateFixes++
        val heading = (atan2(direction.unit.x, direction.unit.y) * 180 / PI + 360) % 360
        val turn = abs((((heading - heldHeading!! + 540) % 360) - 180))
        val reverse = turn >= 135
        val neededDistance = if (reverse) config.cameraReverseConfirmM else config.cameraConfirmM
        val neededFixes = if (reverse) config.cameraReverseConfirmFixes else config.cameraConfirmFixes
        if (distance + 1e-6 >= neededDistance && cameraCandidateFixes >= neededFixes) {
            heldHeading = heading
            cameraAnchor = p
            cameraCandidate = null
            cameraCandidateFixes = 0
        }
    }
}

/** Only accepted measurements become cadence anchors. */
internal class GpsCadenceTracker {
    private val intervals = mutableListOf<Double>()
    var cadenceMs = 1000.0
        private set
    fun reset() {
        intervals.clear()
        cadenceMs = 1000.0
    }
    fun accept(previous: Double?, timestamp: Double, freshnessMs: Double): Boolean {
        val interval = previous?.let { timestamp - it } ?: 0.0
        val gap = previous != null && interval > freshnessMs
        if (gap) reset()
        else if (interval > 0) {
            intervals.add(interval)
            while (intervals.size > 5) intervals.removeAt(0)
            cadenceMs = intervals.sorted()[intervals.size / 2].coerceIn(100.0, 3000.0)
        }
        return gap
    }
}

/** Braking disagreement is bounded and recoverable
each evidence reset is owned here. */
internal class OvershootRecovery {
    private var contradictionAt: Double? = null
    private var contradictionCount = 0
    private var contradictionFix: MotionVector? = null
    var recovering = false
        private set
    fun reset() {
        contradictionAt = null
        contradictionCount = 0
        contradictionFix = null
        recovering = false
    }
    fun update(error: MotionVector, axis: MotionVector?, measured: MotionVector,
               accuracy: Double, now: Double, config: MotionConfig) {
        val behind = axis != null && error.dot(axis) < -0.25
        val consistent = contradictionFix?.let { (measured + it * -1.0).length <= max(1.0, accuracy * 0.5) } ?: false
        if (behind) {
            if (consistent) contradictionCount++ else {
                contradictionAt = now
                contradictionCount = 1
            }
            contradictionFix = measured
        } else {
            contradictionAt = null
            contradictionCount = 0
            contradictionFix = null
        }
        recovering = contradictionAt?.let { (accuracy <= config.goodAccuracyM || contradictionCount >= 3) && now - it >= config.recoveryAfterS * 1000 } ?: false
    }
}

/** Continuous correction/prediction integrator. Speed/config changes preserve unfinished correction.
 * @parity /modules/vescape-core/ios/watch/LiveGpsMotion.swift `LiveGpsMotion`
 */
internal class LiveGpsMotion {
    var config = MotionConfig()
    private set
    private var origin: MotionFix? = null
    private var fix: MotionFix? = null
    private var p = MotionVector()
    private var time = 0.0
    private var correction = MotionVector()
    private var correctionEnd = 0.0
    private var speed = 0.0
    private var speedAt = Double.NEGATIVE_INFINITY
    private var speedRevision = Double.NEGATIVE_INFINITY
    private var latestFixTimestamp = Double.NEGATIVE_INFINITY
    private var fixAt = Double.NEGATIVE_INFINITY
    private var source = 0.0
    private var resetAt = Double.NEGATIVE_INFINITY
    private val cadence = GpsCadenceTracker()
    private val pointDirection = TravelDirection()
    private val headingConfirmer = CameraHeadingConfirmer()
    private val overshoot = OvershootRecovery()
    private var predictedM = 0.0
    private var gpsUsable = true
    val recovering get() = overshoot.recovering
    private var brakingAxis: MotionVector? = null
    val cadenceMs get() = cadence.cadenceMs
    fun reset(source: Double, now: Double) {
        if (source < this.source) return
        this.source = source
        resetAt = now
        time = now
        latestFixTimestamp = Double.NEGATIVE_INFINITY
        origin = null
        fix = null
        p = MotionVector()
        correction = MotionVector()
        correctionEnd = now
        speed = 0.0
        speedAt = Double.NEGATIVE_INFINITY
        speedRevision = Double.NEGATIVE_INFINITY
        fixAt = Double.NEGATIVE_INFINITY
        cadence.reset()
        pointDirection.reset()
        headingConfirmer.reset()
        overshoot.reset()
        predictedM = 0.0
        brakingAxis = null
        gpsUsable = true
    }
    fun configure(config: MotionConfig, now: Double) {
        advance(now)
        this.config = config
    }
    fun updateSpeed(mps: Double?, revision: Double, receivedAt: Double, source: Double, ageMs: Double = 0.0): Boolean {
        if (source != this.source || receivedAt < resetAt || revision <= speedRevision) return false
        advance(receivedAt)
        speedRevision = revision
        speed = mps?.takeIf { it.isFinite() }?.let { abs(it) } ?: 0.0
        speedAt = receivedAt - max(0.0, ageMs)
        return true
    }
    fun accept(fix: MotionFix, receivedAt: Double, ageMs: Double, source: Double): Boolean {
        if (source != this.source || !receivedAt.isFinite() || receivedAt < resetAt ||
            !fix.timestamp.isFinite() || fix.timestamp <= latestFixTimestamp) return false
        latestFixTimestamp = fix.timestamp
        val accuracy = fix.accuracyM
        val usable = fix.longitude.isFinite() && fix.latitude.isFinite() &&
            abs(fix.latitude) <= 85 && abs(fix.longitude) <= 180 && accuracy != null &&
            accuracy.isFinite() && accuracy >= 0 && accuracy <= config.maxAccuracyM &&
            ageMs.isFinite() && ageMs >= 0 && ageMs < config.gpsFreshnessS * 1000
        if (!usable) {
            advance(receivedAt)
            gpsUsable = false
            return false
        }
        // The classification above established a usable accuracy.
        val acceptedAccuracy = accuracy!!
        advance(receivedAt)
        val previous = this.fix
        val gap = cadence.accept(previous?.timestamp, fix.timestamp, config.gpsFreshnessS * 1000)
        if (gap) {
            pointDirection.reset()
            headingConfirmer.reset()
            brakingAxis = null
            overshoot.reset()
        }
        if (origin == null) {
            origin = fix
            p = MotionVector()
        }
        val measured = toMeters(fix)
        this.fix = fix
        gpsUsable = true
        fixAt = receivedAt - ageMs
        predictedM = 0.0
        pointDirection.update(measured, acceptedAccuracy, fixAt, config.pointWindow, config)
        headingConfirmer.update(measured, acceptedAccuracy, fixAt, config)
        val direction = pointDirection.read(receivedAt, config)
        if (direction != null) brakingAxis = direction.unit
        val error = measured + p * -1.0
        val axis = direction?.unit ?: brakingAxis
        overshoot.update(error, axis, measured, acceptedAccuracy, receivedAt, config)
        correction = error * (1000 / cadenceMs)
        val recoverySpeed = config.recoverySpeedMps * max(0.2, ((config.maxAccuracyM - acceptedAccuracy) / (config.maxAccuracyM - config.goodAccuracyM)).coerceIn(0.0, 1.0))
        if (recovering && correction.length > recoverySpeed) correction = correction * (recoverySpeed / correction.length)
        correctionEnd = receivedAt + if (recovering) max(cadenceMs, error.length / recoverySpeed * 1000) else cadenceMs
        if (previous == null) {
            p = measured
            correction = MotionVector()
        }
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
    private data class Prediction(val direction: MotionDirection?,
    val confidence: Double,
    val deadline: Double,
    val velocity: MotionVector)
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
        var position = p
        var at = time
        var predicted = predictedM
        while (at < now) {
            val prediction = prediction(at, predicted)
            val pv = prediction.velocity
            val predictionEnd = if (pv.length > 0) min(prediction.deadline, at + (config.maxPredictionM - predicted) / pv.length * 1000) else Double.POSITIVE_INFINITY
            val end = minOf(now, if (correctionEnd > at) correctionEnd else Double.POSITIVE_INFINITY, predictionEnd)
            var velocity = (if (at < correctionEnd) correction else MotionVector()) + pv
            val axis = brakingAxis
            if (!recovering && axis != null && velocity.dot(axis) < 0) velocity += axis * -velocity.dot(axis)
            val dt = (end - at) / 1000
            position += velocity * dt
            predicted += pv.length * dt
            if (end <= at) break
            at = end
        }
        return Pair(position, predicted)
    }
    private fun advance(now: Double) {
        if (now <= time) return
        pointDirection.read(time, config)?.let { brakingAxis = it.unit }
        val next = project(now)
        p = next.first
        predictedM = next.second
        time = now
    }
    fun isAcceptedFix(timestamp: Double) = fix?.timestamp == timestamp
    fun position(now: Double) = coordinate(project(max(now, time)).first)
    fun cameraHeading(now: Double): Double? = headingConfirmer.read()
    fun pointHeading(now: Double) = pointDirection.read(now, config)?.let { (atan2(it.unit.x, it.unit.y) * 180 / PI + 360) % 360 }
    fun predictionChangeKey(now: Double): List<Double> {
        val prediction = prediction(now, project(now).second)
        return listOf(prediction.velocity.x, prediction.velocity.y,
            if (prediction.velocity.length > 0) prediction.deadline else 0.0)
    }
    fun effectivePrediction(now: Double) = prediction(now).velocity.length / if (speed != 0.0) speed else 1.0
    fun movingUntil(now: Double): Double = max(if (correction.length > 0) correctionEnd else 0.0, prediction(now).let { if (it.velocity.length > 0) it.deadline else 0.0 })
    fun segments(now: Double): List<Map<String, Any>> {
        val state = project(max(now, time))
        val prediction = prediction(now, state.second)
        val budgetEnd = if (prediction.velocity.length > 0)
            now + max(0.0, config.maxPredictionM - state.second) / prediction.velocity.length * 1000
            else now
        val boundaries = listOf(now, if (correction.length > 0) max(now, correctionEnd) else now,
            if (prediction.velocity.length > 0) min(prediction.deadline, budgetEnd) else now)
            .filter { it.isFinite() }.distinct().sorted()
        return boundaries.zipWithNext().mapNotNull { (start, end) ->
            val from = position(start) ?: return@mapNotNull null
            val to = position(end) ?: return@mapNotNull null
            mapOf("startMs" to start, "endMs" to end,
                "from" to listOf(from.first, from.second), "to" to listOf(to.first, to.second))
        }.dropLastWhile { it["from"] == it["to"] }
    }
    // @parity /modules/vescape-core/src/mapDisplay.ts `MapDisplaySnapshot`
    fun snapshot(now: Double): Map<String, Any?> {
        val coordinate = position(now)
        val direction = pointDirection.read(now, config)
        return mapOf(
            "position" to coordinate?.let { listOf(it.first, it.second) },
            "segments" to segments(now), "pointHeading" to pointHeading(now),
            "headingUntilMs" to direction?.let { it.at + config.directionRetentionS * 1000 },
            "cameraHeading" to cameraHeading(now)
        )
    }
    fun diagnostics(now: Double): Map<String, Any?> {
        val prediction = prediction(now)
        return mapOf(
            "measured" to fix?.let { mapOf("longitude" to it.longitude, "latitude" to it.latitude,
                "timestamp" to it.timestamp, "accuracyM" to it.accuracyM) },
            "displayed" to position(now)?.let { listOf(it.first, it.second) },
            "cadenceMs" to cadenceMs, "confidence" to prediction.confidence,
            "effectivePrediction" to effectivePrediction(now),
            "directionAgeMs" to prediction.direction?.let { now - it.at },
            "recovering" to recovering,
            "reason" to when {
                !gpsUsable -> "gps-unusable"
                recovering -> "persistent-overshoot-recovery"
                fix == null -> "acquiring"
                prediction.direction == null -> "direction-unavailable"
                now >= prediction.deadline -> "input-expired"
                speed == 0.0 -> "board-stopped-or-missing"
                else -> "predicting"
            }
        )
    }
}
