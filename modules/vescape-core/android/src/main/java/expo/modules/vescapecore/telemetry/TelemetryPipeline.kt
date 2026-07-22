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

/** One decimated live metric: a key the JS UI knows + how to read it off a telemetry row. */
internal data class LiveSeriesMetric(val key: String, val select: (Map<String, Any?>) -> Double?)

private fun Map<String, Any?>.num(key: String): Double? = (this[key] as? Number)?.toDouble()

private fun Map<String, Any?>.excluded(key: String): Boolean =
    (this["metricExclusions"] as? Map<*, *>)?.get(key) == true

/**
 * Center-screen live metrics streamed continuously as the decimated `onLiveSeries`
 * firehose (strip + dual gauge + battery sparklines). Kept in sync with `liveSelectors`
 * on the JS side, keyed by the same names: any abs/scale/exclusion is applied here
 * *before* min/max bucketing so native decimation matches what JS would compute, and
 * the UI renders the values verbatim.
 *
 * Detail-only metrics live in [FOCUSED_ONLY_SERIES_METRICS] and are not streamed
 * globally — a `/control` detail screen pulls them via [focusedSeries] on focus.
 *
 * @parity /modules/vescape-core/src/index.ts `liveSelectors`
 */
internal val LIVE_SERIES_METRICS = listOf(
    LiveSeriesMetric("motorTemp") { row -> row.num("tempMotor")?.takeIf { it > 0 } },
    LiveSeriesMetric("controllerTemp") { row -> row.num("tempMosfet") },
    LiveSeriesMetric("motorCurrent") { row -> row.num("motorCurrent") },
    LiveSeriesMetric("batteryCurrent") { row -> row.num("batteryCurrent") },
    LiveSeriesMetric("batteryVoltage") { row -> row.num("batteryVoltage") },
    LiveSeriesMetric("batteryPercent") { row -> row.num("batteryPercent") },
    LiveSeriesMetric("speed") { row ->
        if (row.excluded("max_speed")) null else row.num("speed")?.let { kotlin.math.abs(it) }
    },
    LiveSeriesMetric("duty") { row ->
        if (row.excluded("max_duty")) null else row.num("dutyCycle")?.let { kotlin.math.abs(it) * 100 }
    },
)

/** Detail-chart-only metrics (no center sparkline). Served only via [focusedSeries]. */
internal val FOCUSED_ONLY_SERIES_METRICS = listOf(
    LiveSeriesMetric("pitch") { row -> row.num("pitch") },
    LiveSeriesMetric("roll") { row -> row.num("roll") },
    LiveSeriesMetric("balancePitch") { row -> row.num("balancePitch") },
    LiveSeriesMetric("footpadAdc1") { row -> row.num("adc1") },
    LiveSeriesMetric("footpadAdc2") { row -> row.num("adc2") },
)

/** Every live metric a `/control` detail chart can focus (center + detail-only). */
internal val ALL_SERIES_METRICS = LIVE_SERIES_METRICS + FOCUSED_ONLY_SERIES_METRICS

/** Exclusion keys whose contiguous spans ride along with a focused series for overlay bands. */
internal val LIVE_EXCLUSION_KEYS = listOf(METRIC_AVG_SPEED, METRIC_MAX_SPEED, METRIC_MAX_DUTY)

/**
 * Focused detail-chart resolution: fixed-width time buckets (constant scrub resolution
 * regardless of window length), capped so a long window can't blow up the payload.
 * @parity /modules/vescape-core/ios/telemetry/LiveSeriesEmitter.swift `focusedBucketWidthMs`
 */
internal const val FOCUSED_SERIES_BUCKET_WIDTH_MS = 250L
internal const val FOCUSED_SERIES_MAX_BUCKETS = 1500

/** Render-ready focused series for one metric plus its excluded spans, per exclusion key. */
internal data class FocusedSeries(
    val series: DoubleArray,
    val exclusions: Map<String, DoubleArray>,
    val windowMs: Long,
)

internal data class ProcessedTelemetry(
    val eventMap: MutableMap<String, Any?>,
    val capture: TelemetryCapture,
    val metricExclusionUpdates: List<Map<String, Any?>>,
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
    private val liveTelemetryPoints = ArrayDeque<LivePoint>()
    // recentTelemetry is appended on the BLE callback thread and read (snapshot/decimated)
    // on the main thread, so every structural access goes through this lock.
    private val recentLock = Any()
    // liveTelemetryPoints is also touched by settings/session calls while telemetry is flowing.
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
        synchronized(recentLock) { recentTelemetry.clear() }
        synchronized(liveLock) { liveTelemetryPoints.clear() }
        lastTelemetryAt = 0L
        this.session = session
        this.sessionConfig = config
        // The active CAN id is seeded by the service from the stored Board
        // Transport via updateCanId; a fresh session starts untagged.
        this.canId = null
    }

    fun endSession() {
        cancelStaleWatchdog()
        synchronized(recentLock) { recentTelemetry.clear() }
        synchronized(liveLock) { liveTelemetryPoints.clear() }
        lastTelemetryAt = 0L
        session = null
        sessionConfig = null
        canId = null
    }

    fun updateCanId(canId: Int?) {
        this.canId = canId
    }

    /**
     * Drops prior connection data before reconnecting within the same Board Session.
     * Reconnect reuses its session identity, so resetLastTelemetryAt alone would leave
     * stale values available to the live state and decimated-series read paths.
     */
    fun clearLiveTelemetry() {
        cancelStaleWatchdog()
        synchronized(recentLock) { recentTelemetry.clear() }
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

    /**
     * Render-ready min/max series per metric, decimated from the in-memory live
     * window. Lets the UI draw sparklines without streaming every raw sample.
     */
    fun liveSeries(metrics: List<LiveSeriesMetric>, bucketCount: Int): Map<String, DoubleArray> {
        // Copy the deque under lock, then decimate the snapshot without holding it.
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

    /**
     * High-resolution series for a single focused metric, decimated on **fixed-width**
     * time buckets ([FOCUSED_SERIES_BUCKET_WIDTH_MS], capped to [FOCUSED_SERIES_MAX_BUCKETS])
     * so scrub resolution stays constant as the window grows. Rides with the contiguous
     * excluded spans per exclusion key so the detail chart can redraw its overlay bands.
     * Returns null for an unknown metric key.
     */
    fun focusedSeries(metricKey: String): FocusedSeries? {
        val metric = ALL_SERIES_METRICS.find { it.key == metricKey } ?: return null
        val rows = synchronized(recentLock) { if (recentTelemetry.isEmpty()) null else recentTelemetry.toList() }
            ?: return FocusedSeries(DoubleArray(0), emptyMap(), recentWindowMs())
        val windowMs = recentWindowMs()
        val bucketCount = (windowMs / FOCUSED_SERIES_BUCKET_WIDTH_MS)
            .toInt().coerceIn(1, FOCUSED_SERIES_MAX_BUCKETS)
        val series = LiveSeriesDownsampler.downsampleMinMax(
            rows,
            bucketCount,
            windowMs,
            { (it["lastPacketAt"] as Number).toLong() },
            metric.select,
        )
        return FocusedSeries(series, excludedSpans(rows), windowMs)
    }

    /**
     * Contiguous [start, end] runs (flat `[s0, e0, s1, e1, ...]`) per exclusion key across
     * the window. JS unions the keys a screen cares about and merges them into overlay bands.
     */
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

    fun process(parsed: RefloatTelemetry, sessionToken: BoardSession): ProcessedTelemetry? {
        val cfg = sessionConfig ?: return null
        val currentSession = session ?: return null
        if (sessionToken !== currentSession || !sessionToken.isActive) return null

        lastTelemetryAt = parsed.lastPacketAt
        armStaleWatchdog()

        val capture = captureBuilder(parsed, cfg, canId)
        val baseEventMap = parsed.toMap().toMutableMap()
        val bucketPoint = FullTelemetryState.from(capture).toBucketPoint()
        val updates = synchronized(liveLock) {
            liveTelemetryPoints.addLast(LivePoint(bucketPoint, baseEventMap))
            pruneLiveTelemetryPoints(parsed.lastPacketAt)
            sanitizeLivePoints()
        }
        synchronized(recentLock) {
            recentTelemetry.addLast(baseEventMap)
            pruneRecentTelemetry(parsed.lastPacketAt)
        }

        return ProcessedTelemetry(baseEventMap, capture, updates)
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
            recentTelemetry.removeFirst()
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
