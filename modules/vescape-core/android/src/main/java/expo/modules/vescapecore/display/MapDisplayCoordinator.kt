package expo.modules.vescapecore.display

import kotlin.math.*

/** Native input ownership. Scheduling and clocks are injected; no GPS/recording lifetime changes.
 * @parity /modules/vescape-core/ios/watch/MapDisplayCoordinator.swift
 * @parity /modules/vescape-core/src/mapDisplay.ts
 */
internal class MapDisplayCoordinator(
    private val clock: () -> Double,
    private val schedule: (Double, () -> Unit) -> (() -> Unit),
    private val emit: (Map<String, Any?>) -> Unit,
) {
    val model = LiveGpsMotion()
    private var active = false
    private var diagnostics = false
    private var trailEnabled = false
    private var rawEnabled = false
    private var source = -1.0
    private var benchSource = 0.0
    private var generation = -1.0
    private var connected = false
    private var rate = 1.0
    private var localAnchor = 0.0
    private var displayAnchor = 0.0
    private var sourceAnchor = 0.0
    private var sourceDisplayAnchor = 0.0
    private var latestClock = Double.NEGATIVE_INFINITY
    private var latestRawTimestamp = Double.NEGATIVE_INFINITY
    private var lastTrailSampleLocal = Double.NEGATIVE_INFINITY
    private var lastSpeedAt = Double.NEGATIVE_INFINITY
    private var lastDiagnosticsAt = Double.NEGATIVE_INFINITY
    private var diagnosticSnapshot: Map<String, Any?>? = null
    private var revision = 0
    private var raw: Map<String, Any?>? = null
    private val trail = mutableListOf<Pair<Double, List<Double>>>()
    private var cancelDebug: (() -> Unit)? = null
    private var cancelBoundary: (() -> Unit)? = null
    private fun now() = displayAnchor + (clock() - localAnchor) * rate
    private fun age(timestamp: Double) = max(0.0, sourceAnchor + now() - sourceDisplayAnchor - timestamp)
    private fun number(body: Map<*, *>, key: String) = (body[key] as? Number)?.toDouble()

    @Synchronized fun stop() {
        active = false
        cancelDebug?.invoke()
        cancelBoundary?.invoke()
        cancelDebug = null
        cancelBoundary = null
        trail.clear()
        raw = null
    }

    @Synchronized fun options(body: Map<*, *>) {
        val wasActive = active
        active = body["active"] as? Boolean ?: active
        val nextDiagnostics = body["diagnostics"] as? Boolean ?: diagnostics
        if (nextDiagnostics != diagnostics) lastDiagnosticsAt = Double.NEGATIVE_INFINITY
        diagnostics = nextDiagnostics
        trailEnabled = body["trail"] as? Boolean ?: trailEnabled
        rawEnabled = body["raw"] as? Boolean ?: rawEnabled
        if (!trailEnabled) trail.clear()
        if (!rawEnabled && !diagnostics) {
            raw = null
            latestRawTimestamp = Double.NEGATIVE_INFINITY
        }
        if (!active) {
            stop()
            return
        }
        if (!wasActive) {
            source = -1.0
            latestClock = Double.NEGATIVE_INFINITY
        }
        publish()
    }

    private fun adopt(body: Map<*, *>): Boolean {
        val id = number(body, "displaySourceId") ?: return false
        val sourceClock = number(body, "displayClockMs") ?: return false
        if (!id.isFinite() || !sourceClock.isFinite() || id < source) return false
        val reset = id > source
        if (!reset && (sourceClock < latestClock || (sourceClock == latestClock && number(body, "displayClockRate") != rate))) return false
        if (reset) {
            source = id
            model.reset(source, now())
            raw = null
            lastDiagnosticsAt = Double.NEGATIVE_INFINITY
            trail.clear()
            latestRawTimestamp = Double.NEGATIVE_INFINITY
            lastSpeedAt = Double.NEGATIVE_INFINITY
        }
        displayAnchor = now()
        localAnchor = clock()
        rate = number(body, "displayClockRate")?.takeIf { it.isFinite() }?.coerceIn(0.1, 100.0) ?: 1.0
        sourceAnchor = sourceClock
        sourceDisplayAnchor = now()
        latestClock = sourceClock
        return true
    }

    @Synchronized fun input(name: String, body: Map<*, *>) {
        if (!active) return
        when (name) {
            "onLiveState" -> {
                val board = body["board"] as? Map<*, *> ?: return
                val seq = number(board, "connectionSeq") ?: return
                if (seq < generation) return
                val gps = body["gps"] as? Map<*, *> ?: return
                if (!adopt(gps)) return
                generation = seq
                connected = board["phase"] == "connected"
                val latest = listOf("latestFix", "latestApproximateFix", "latestPreciseFix")
                    .mapNotNull { gps[it] as? Map<*, *> }
                    .filter { number(it, "timestamp")?.isFinite() == true }
                    .maxByOrNull { number(it, "timestamp")!! }
                if (latest != null) fix(latest)
                if (!connected) model.updateSpeed(null, sourceAnchor + now() - sourceDisplayAnchor, now(), source)
                else (board["recentTelemetry"] as? List<*>)?.lastOrNull()?.let { (it as? Map<*, *>)?.let { tick(it) } }
            }
            "onLocation" -> {
                if (!adopt(body)) return
                fix(body)
            }
            "onLiveTick" -> {
                val oldSource = source
                val oldRate = rate
                if (!connected || number(body, "generation") != generation || !adopt(body)) return
                if (!tick(body) && source == oldSource && rate == oldRate) return
            }
            else -> return
        }
        publish()
    }

    private fun fix(body: Map<*, *>, ageOverride: Double? = null) {
        val timestamp = number(body, "timestamp") ?: return
        val longitude = number(body, "longitude") ?: Double.NaN
        val latitude = number(body, "latitude") ?: Double.NaN
        val accuracy = number(body, "accuracyM")
        val at = now()
        val inputAge = ageOverride ?: age(timestamp)
        sample(at, boundary = true)
        val accepted = model.accept(MotionFix(longitude, latitude, timestamp, accuracy), at, inputAge, source)
        if ((rawEnabled || diagnostics) && timestamp.isFinite() && timestamp > latestRawTimestamp) {
            latestRawTimestamp = timestamp
            if (longitude.isFinite() && latitude.isFinite() && abs(longitude) <= 180 && abs(latitude) <= 90) raw =
                mapOf("coordinate" to listOf(longitude, latitude), "timestamp" to timestamp,
                    "atMs" to (at - inputAge), "accepted" to (accepted || model.isAcceptedFix(timestamp)),
                    "accuracyM" to accuracy?.takeIf { it.isFinite() })
        }
    }

    private fun tick(body: Map<*, *>): Boolean {
        if (number(body, "generation") != generation) return false
        val timestamp = number(body, "lastPacketAt") ?: return false
        val speed = number(body, "speed")
        val at = now()
        if (speed != 0.0 && clock() - lastSpeedAt < 100) return false
        sample(at)
        val previous = model.predictionChangeKey(at)
        val changed = model.updateSpeed(speed?.div(3.6), timestamp, at, source, age(timestamp))
        if (changed) lastSpeedAt = clock()
        return changed && previous != model.predictionChangeKey(at)
    }

    @Synchronized fun configure(config: MotionConfig) {
        sample(now(), boundary = true)
        model.configure(config, now())
        if (active) publish()
    }

    /** Bench measurements never enter live providers, Watch Frames or storage. */
    @Synchronized fun bench(body: Map<*, *>) {
        if (!active) return
        val at = now()
        when (body["op"]) {
            "reset" -> {
                benchSource++
                source = benchSource
                model.reset(source, at)
                trail.clear()
                raw = null
                latestRawTimestamp = Double.NEGATIVE_INFINITY
                lastDiagnosticsAt = Double.NEGATIVE_INFINITY
            }
            "fix" -> fix(body, ageOverride = 0.0)
            "speed" -> {
                sample(at)
                model.updateSpeed(number(body, "mps"), at, at, source)
            }
        }
        publish()
    }

    private fun sample(at: Double, boundary: Boolean = false) {
        if (!boundary && clock() - lastTrailSampleLocal < 200) return
        if (!trailEnabled) return
        val coordinate = model.position(at) ?: return
        val value = listOf(coordinate.first, coordinate.second)
        if (trail.lastOrNull()?.second != value) {
            trail.add(at to value)
            lastTrailSampleLocal = clock()
        }
        trail.removeAll { at - it.first > 60_000 }
        while (trail.size > 300) trail.removeAt(0)
    }

    @Synchronized fun snapshot(): Map<String, Any?> {
        val at = now()
        val result = model.snapshot(at).toMutableMap()
        val rawSnapshot = raw?.plus("stale" to (at - (raw?.get("atMs") as Number).toDouble() >= model.config.gpsFreshnessS * 1000))
        if (active && diagnostics && clock() - lastDiagnosticsAt >= 1000) {
            diagnosticSnapshot = model.diagnostics(at) + ("raw" to rawSnapshot)
            lastDiagnosticsAt = clock()
        }
        result.putAll(mapOf("source" to source, "revision" to revision, "clockMs" to at, "localClockMs" to clock(), "clockRate" to rate,
            "raw" to if (rawEnabled || diagnostics) rawSnapshot else null,
            "trail" to if (trailEnabled) trail.map { it.second } else emptyList<List<Double>>(),
            "diagnostics" to if (active && diagnostics) diagnosticSnapshot else null))
        return result
    }

    private fun publish() {
        if (!active) return
        revision++
        emit(snapshot())
        cancelBoundary?.invoke()
        cancelBoundary = null
        val at = now()
        val boundaries = model.segments(at).map { (it["endMs"] as Number).toDouble() } +
            listOfNotNull((model.snapshot(at)["headingUntilMs"] as? Number)?.toDouble(),
                if (rawEnabled) (raw?.get("atMs") as? Number)?.toDouble()?.plus(model.config.gpsFreshnessS * 1000) else null)
        val next = boundaries.filter { it > at + 0.01 }.minOrNull()
        if (next != null) cancelBoundary = schedule((next - at) / rate) {
            synchronized(this) {
                if (active) {
                    sample(now(), boundary = true)
                    publish()
                }
            }
        }
        cancelDebug?.invoke()
        cancelDebug = null
        val moving = model.segments(at).any { it["from"] != it["to"] }
        if (diagnostics || (trailEnabled && moving)) {
            cancelDebug = schedule(if (trailEnabled && moving) 200.0 else 1000.0) {
                synchronized(this) {
                    if (active) {
                        sample(now())
                        publish()
                    }
                }
            }
        }
    }
}
