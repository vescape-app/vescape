package expo.modules.vescapecore.telemetry

import expo.modules.vescapecore.protocol.RefloatTelemetry
import expo.modules.vescapecore.service.SessionConfig
import expo.modules.vescapecore.runtime.BoardSession
import expo.modules.vescapecore.runtime.Cancellable
import expo.modules.vescapecore.runtime.Scheduler

internal const val DEFAULT_LIVE_HISTORY_LIMIT_MINUTES = 5
internal const val MIN_LIVE_HISTORY_LIMIT_MINUTES = 1
internal const val MAX_LIVE_HISTORY_LIMIT_MINUTES = 50
internal const val DEFAULT_TELEMETRY_STALE_MS = 4_000L

internal data class LiveSeriesMetric(val key: String, val select: (Map<String, Any?>) -> Double?)

private fun Map<String, Any?>.num(key: String): Double? = (this[key] as? Number)?.toDouble()

private fun Map<String, Any?>.excluded(key: String): Boolean =
    (this["metricExclusions"] as? Map<*, *>)?.get(key) == true

/**
 * @parity /modules/vescape-core/ios/telemetry/LiveSeriesEmitter.swift `centerMetrics`
 * @parity /src/modules/board/hooks/useLiveMetric.ts `liveSelectors`
 */
internal val LIVE_SERIES_METRICS = listOf(
    LiveSeriesMetric("batteryVoltage") { row -> row.num("batteryVoltage") },
    LiveSeriesMetric("batteryPercent") { row -> row.num("batteryPercent") },
)

internal val FOCUSED_ONLY_SERIES_METRICS = listOf(
    LiveSeriesMetric("motorTemp") { row -> row.num("tempMotor")?.takeIf { it > 0 } },
    LiveSeriesMetric("controllerTemp") { row -> row.num("tempMosfet") },
    LiveSeriesMetric("motorCurrent") { row -> row.num("motorCurrent") },
    LiveSeriesMetric("batteryCurrent") { row -> row.num("batteryCurrent") },
    LiveSeriesMetric("speed") { row ->
        if (row.excluded("max_speed")) null else row.num("speed")?.let { kotlin.math.abs(it) }
    },
    LiveSeriesMetric("duty") { row ->
        if (row.excluded("max_duty")) null else row.num("dutyCycle")?.let { kotlin.math.abs(it) * 100 }
    },
    LiveSeriesMetric("pitch") { row -> row.num("pitch") },
    LiveSeriesMetric("roll") { row -> row.num("roll") },
    LiveSeriesMetric("balancePitch") { row -> row.num("balancePitch") },
    LiveSeriesMetric("footpadAdc1") { row -> row.num("adc1") },
    LiveSeriesMetric("footpadAdc2") { row -> row.num("adc2") },
)

internal val ALL_SERIES_METRICS = LIVE_SERIES_METRICS + FOCUSED_ONLY_SERIES_METRICS

internal val LIVE_EXCLUSION_KEYS = listOf(METRIC_AVG_SPEED, METRIC_MAX_SPEED, METRIC_MAX_DUTY)

/**
 * @parity /modules/vescape-core/ios/telemetry/LiveSeriesEmitter.swift `focusedBucketWidthMs`
 */
internal const val FOCUSED_SERIES_BUCKET_WIDTH_MS = 20L

internal data class FocusedSeries(
    val series: DoubleArray,
    val exclusions: Map<String, DoubleArray>,
    val windowMs: Long,
    val spanMs: Long,
    val sampleRateHz: Double,
)

internal data class ProcessedTelemetry(
    val eventMap: MutableMap<String, Any?>,
    val capture: TelemetryCapture,
    val speedPeak: Double?,
    val dutyPeak: Double?,
)

internal class TelemetryPipeline(
    private val scheduler: Scheduler,
    private val onTelemetryStale: () -> Unit,
    private val captureBuilder: (RefloatTelemetry, SessionConfig, Int?) -> TelemetryCapture,
    private val nowMs: () -> Long = System::currentTimeMillis,
    private val staleTimeoutMs: Long = DEFAULT_TELEMETRY_STALE_MS,
) {
    private data class LivePoint(
        val bucketPoint: BucketTelemetryPoint,
        val eventMap: MutableMap<String, Any?>,
    )

    private val recentTelemetry = ArrayDeque<MutableMap<String, Any?>>()
    private val speedPeak = LiveWindowPeak(ALL_SERIES_METRICS.first { it.key == "speed" }.select)
    private val dutyPeak = LiveWindowPeak(ALL_SERIES_METRICS.first { it.key == "duty" }.select)
    private val liveTelemetryPoints = ArrayDeque<LivePoint>()
    private val recentLock = Any()
    private val liveLock = Any()
    private var session: BoardSession? = null
    private var sessionConfig: SessionConfig? = null
    private var canId: Int? = null
    private var liveHistoryLimitMinutes = DEFAULT_LIVE_HISTORY_LIMIT_MINUTES
    private var staleHandle: Cancellable? = null

    var lastTelemetryAt: Long = 0L
        private set
    var metricSanitizerConfig: MetricSanitizerConfig = MetricSanitizerConfig()

    fun beginSession(session: BoardSession, config: SessionConfig) {
        cancelStaleWatchdog()
        clearRecentTelemetry()
        synchronized(liveLock) { liveTelemetryPoints.clear() }
        lastTelemetryAt = 0L
        this.session = session
        this.sessionConfig = config
        this.canId = null
    }

    fun endSession() {
        cancelStaleWatchdog()
        clearRecentTelemetry()
        synchronized(liveLock) { liveTelemetryPoints.clear() }
        lastTelemetryAt = 0L
        session = null
        sessionConfig = null
        canId = null
    }

    fun updateCanId(canId: Int?) {
        this.canId = canId
    }

    fun clearLiveTelemetry() {
        cancelStaleWatchdog()
        clearRecentTelemetry()
        synchronized(liveLock) { liveTelemetryPoints.clear() }
        lastTelemetryAt = 0L
    }

    fun setLiveHistoryLimitMinutes(minutes: Int) {
        liveHistoryLimitMinutes = minutes.coerceIn(
            MIN_LIVE_HISTORY_LIMIT_MINUTES,
            MAX_LIVE_HISTORY_LIMIT_MINUTES,
        )
        val now = nowMs()
        synchronized(recentLock) { pruneRecentTelemetry(now) }
        synchronized(liveLock) { pruneLiveTelemetryPoints(now) }
    }

    fun liveHistoryLimitMinutes(): Int = liveHistoryLimitMinutes

    fun recentWindowMs(): Long = liveHistoryLimitMinutes.toLong() * 60_000L

    fun recentSnapshot(): List<Map<String, Any?>> = synchronized(recentLock) { recentTelemetry.toList() }

    fun liveSeries(metrics: List<LiveSeriesMetric>, bucketCount: Int): Map<String, DoubleArray> {
        val rows = synchronized(recentLock) { if (recentTelemetry.isEmpty()) null else recentTelemetry.toList() }
            ?: return emptyMap()
        val windowMs = recentWindowMs()
        val result = HashMap<String, DoubleArray>(metrics.size)
        for (metric in metrics) {
            result[metric.key] = LiveSeriesDownsampler.downsampleMinMax(
                rows,
                bucketCount,
                windowMs,
                { (it["lastPacketAt"] as Number).toLong() },
                metric.select,
            )
        }
        return result
    }

    fun focusedSeries(metricKey: String, spans: Map<String, DoubleArray>? = null): FocusedSeries? {
        val metric = ALL_SERIES_METRICS.find { it.key == metricKey } ?: return null
        val rows = synchronized(recentLock) { if (recentTelemetry.isEmpty()) null else recentTelemetry.toList() }
            ?: return FocusedSeries(DoubleArray(0), emptyMap(), recentWindowMs(), 0L, 0.0)
        val windowMs = recentWindowMs()
        val bucketCount = (windowMs / FOCUSED_SERIES_BUCKET_WIDTH_MS).toInt().coerceAtLeast(1)
        val series = LiveSeriesDownsampler.downsampleMinMax(
            rows,
            bucketCount,
            windowMs,
            { (it["lastPacketAt"] as Number).toLong() },
            metric.select,
        )
        val spanMs = sampleSpanMs(rows)
        return FocusedSeries(
            series,
            spans ?: excludedSpans(rows),
            windowMs,
            spanMs,
            if (spanMs > 0L) (rows.size - 1) * 1000.0 / spanMs else 0.0,
        )
    }

    private fun sampleSpanMs(rows: List<Map<String, Any?>>): Long {
        if (rows.size < 2) return 0L
        val first = (rows.first()["lastPacketAt"] as? Number)?.toLong() ?: return 0L
        val last = (rows.last()["lastPacketAt"] as? Number)?.toLong() ?: return 0L
        return (last - first).coerceAtLeast(0L)
    }

    fun focusedExclusionSpans(): Map<String, DoubleArray> =
        excludedSpans(synchronized(recentLock) { recentTelemetry.toList() })

    private fun excludedSpans(rows: List<Map<String, Any?>>): Map<String, DoubleArray> {
        val out = HashMap<String, DoubleArray>(LIVE_EXCLUSION_KEYS.size)
        for (key in LIVE_EXCLUSION_KEYS) {
            val spans = ArrayList<Double>()
            var startTs = Long.MIN_VALUE
            var endTs = Long.MIN_VALUE
            for (row in rows) {
                val ts = (row["lastPacketAt"] as? Number)?.toLong() ?: continue
                if (row.excluded(key)) {
                    if (startTs == Long.MIN_VALUE) startTs = ts
                    endTs = ts
                } else if (startTs != Long.MIN_VALUE) {
                    spans.add(startTs.toDouble()); spans.add(endTs.toDouble())
                    startTs = Long.MIN_VALUE
                }
            }
            if (startTs != Long.MIN_VALUE) { spans.add(startTs.toDouble()); spans.add(endTs.toDouble()) }
            if (spans.isNotEmpty()) out[key] = spans.toDoubleArray()
        }
        return out
    }

    /** @parity /modules/vescape-core/ios/connection/BoardSessionController.swift `armStaleWatchdog` */
    fun armStaleWatchdog() {
        val armedAt = lastTelemetryAt
        staleHandle?.cancel()
        staleHandle = scheduler.postDelayed(staleTimeoutMs) {
            staleHandle = null
            val stillStale = lastTelemetryAt == armedAt ||
                nowMs() - lastTelemetryAt >= staleTimeoutMs
            if (stillStale) onTelemetryStale()
        }
    }

    fun cancelStaleWatchdog() {
        staleHandle?.cancel()
        staleHandle = null
    }

    /**
     * @parity /modules/vescape-core/ios/connection/BoardSessionController.swift `handleTelemetry`
     */
    fun noteResponse(parsed: RefloatTelemetry, sessionToken: BoardSession) {
        val currentSession = session ?: return
        if (sessionToken !== currentSession || !sessionToken.isActive) return
        lastTelemetryAt = parsed.lastPacketAt
        armStaleWatchdog()
    }

    fun process(parsed: RefloatTelemetry, sessionToken: BoardSession): ProcessedTelemetry? {
        val cfg = currentConfig(sessionToken) ?: return null
        lastTelemetryAt = parsed.lastPacketAt
        armStaleWatchdog()
        return retain(parsed, cfg)
    }

    /**
     * @parity /modules/vescape-core/ios/telemetry/LiveSeriesEmitter.swift `prefill`
     */
    fun prefill(parsed: RefloatTelemetry, sessionToken: BoardSession): ProcessedTelemetry? {
        val cfg = currentConfig(sessionToken) ?: return null
        return retain(parsed, cfg, sanitize = false)
    }

    fun finishPrefill() {
        val updates = synchronized(liveLock) { sanitizeLivePoints() }
        if (updates.isEmpty()) return
        synchronized(recentLock) {
            speedPeak.invalidate()
            dutyPeak.invalidate()
        }
    }

    private fun currentConfig(sessionToken: BoardSession): SessionConfig? {
        val cfg = sessionConfig ?: return null
        val currentSession = session ?: return null
        if (sessionToken !== currentSession || !sessionToken.isActive) return null
        return cfg
    }

    private fun retain(parsed: RefloatTelemetry, cfg: SessionConfig, sanitize: Boolean = true): ProcessedTelemetry {
        val capture = captureBuilder(parsed, cfg, canId)
        val baseEventMap = parsed.toMap().toMutableMap()
        val state = FullTelemetryState.from(capture)
        val bucketPoint = state.toBucketPoint()
        val updates = synchronized(liveLock) {
            liveTelemetryPoints.addLast(LivePoint(bucketPoint, baseEventMap))
            pruneLiveTelemetryPoints(parsed.lastPacketAt)
            if (sanitize) sanitizeLivePoints() else emptyList()
        }
        val peaks = synchronized(recentLock) {
            if (updates.isNotEmpty()) {
                speedPeak.invalidate()
                dutyPeak.invalidate()
            }
            recentTelemetry.addLast(baseEventMap)
            speedPeak.add(baseEventMap)
            dutyPeak.add(baseEventMap)
            pruneRecentTelemetry(parsed.lastPacketAt)
            speedPeak.value(recentTelemetry) to dutyPeak.value(recentTelemetry)
        }

        return ProcessedTelemetry(baseEventMap, capture, peaks.first, peaks.second)
    }

    private fun clearRecentTelemetry() = synchronized(recentLock) {
        recentTelemetry.clear()
        speedPeak.reset()
        dutyPeak.reset()
    }

    private fun pruneLiveTelemetryPoints(now: Long) {
        val oldest = now - recentWindowMs()
        while (liveTelemetryPoints.isNotEmpty() &&
            liveTelemetryPoints.first().bucketPoint.capturedAtMs < oldest
        ) {
            liveTelemetryPoints.removeFirst()
        }
    }

    private fun pruneRecentTelemetry(now: Long) {
        val oldest = now - recentWindowMs()
        while (recentTelemetry.isNotEmpty()) {
            val ts = (recentTelemetry.first()["lastPacketAt"] as? Number)?.toLong() ?: break
            if (ts >= oldest) break
            val dropped = recentTelemetry.removeFirst()
            speedPeak.evict(dropped)
            dutyPeak.evict(dropped)
        }
    }

    private fun sanitizeLivePoints(): List<Map<String, Any?>> {
        if (liveTelemetryPoints.isEmpty()) return emptyList()
        val points = liveTelemetryPoints.map { it.bucketPoint }
        val sanitization = sanitizeTelemetrySamples(points, metricSanitizerConfig)
        val updates = mutableListOf<Map<String, Any?>>()
        val lastIndex = liveTelemetryPoints.size - 1
        liveTelemetryPoints.forEachIndexed { index, point ->
            val exclusions = sanitization.samples[index].toLiveMetricExclusions()
            val previous = point.eventMap["metricExclusions"] as? Map<*, *>
            point.eventMap["metricExclusions"] = exclusions
            if (index != lastIndex && previous != exclusions) updates.add(
                mapOf(
                    "lastPacketAt" to point.bucketPoint.capturedAtMs,
                    "metricExclusions" to exclusions,
                ),
            )
        }
        return updates
    }

    private fun SanitizedSample.toLiveMetricExclusions(): Map<String, Boolean> =
        buildMap {
            if (excludedFromAvgSpeed) put(METRIC_AVG_SPEED, true)
            if (excludedFromMaxSpeed) put(METRIC_MAX_SPEED, true)
            if (excludedFromMaxDuty) put(METRIC_MAX_DUTY, true)
        }
}
