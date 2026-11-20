package expo.modules.vescapecore.telemetry
import expo.modules.vescapecore.runtime.BoardSession
import expo.modules.vescapecore.runtime.Cancellable
import expo.modules.vescapecore.runtime.Scheduler
import expo.modules.vescapecore.runtime.postDelayedForSession

internal class LiveSeriesEmitter(
    private val scheduler: Scheduler,
    private val emitEvent: (String, Map<String, Any?>) -> Unit,
    private val telemetryPipeline: TelemetryPipeline,
    private val session: () -> BoardSession?,
    private val isCurrentSession: (BoardSession) -> Boolean,
    private val generation: () -> Long,
    private val liveSeriesIntervalMs: Long,
    private val liveSeriesBuckets: Int,
) {
    private var liveSeriesHandle: Cancellable? = null
    private var liveSeriesPrimed = false

    /** Metric keys the mounted `/control` detail charts are focused on (JS intent); empty = none. */
    @Volatile
    private var focusedMetrics: Set<String> = emptySet()

    /** Metrics added to the always-on center set while JS shows them (the telemetry panel). */
    private var extraLiveMetrics: List<LiveSeriesMetric> = emptyList()

    fun start() {
        if (liveSeriesHandle == null) {
            liveSeriesPrimed = false
            scheduleLiveSeries()
        }
    }

    fun primeLiveSeriesIfNeeded() {
        if (liveSeriesHandle == null || liveSeriesPrimed) return
        liveSeriesPrimed = true
        emitLiveSeries()
    }

    /** Set which metrics the high-res focused stream covers (empty to stop it); emits immediately. */
    fun setFocusedMetrics(metrics: Set<String>) {
        focusedMetrics = metrics
        if (metrics.isNotEmpty()) emitFocusedSeries()
    }

    /**
     * Set the metrics streamed on `onLiveSeries` beyond the always-on [LIVE_SERIES_METRICS] (empty
     * to drop back to those); emits immediately so the new rows fill without waiting a tick. Runs on
     * the scheduler, the thread the tick emits from, so an older tick can never land after it.
     * @parity /modules/vescape-core/ios/telemetry/LiveSeriesEmitter.swift `setLiveMetrics`
     */
    fun setLiveMetrics(metrics: Set<String>) {
        scheduler.post {
            extraLiveMetrics = ALL_SERIES_METRICS.filter { metric ->
                metric.key in metrics && LIVE_SERIES_METRICS.none { it.key == metric.key }
            }
            if (liveSeriesHandle != null) emitLiveSeries()
        }
    }

    fun stop() {
        liveSeriesHandle?.cancel()
        liveSeriesHandle = null
        liveSeriesPrimed = false
    }

    private fun scheduleLiveSeries() {
        val token = session() ?: return
        liveSeriesHandle = scheduler.postDelayedForSession(token, liveSeriesIntervalMs, isCurrentSession) {
            emitLiveSeries()
            emitFocusedSeries()
            scheduleLiveSeries()
        }
    }

    private fun emitLiveSeries() {
        val metrics = telemetryPipeline.liveSeries(LIVE_SERIES_METRICS + extraLiveMetrics, liveSeriesBuckets)
        if (metrics.isNotEmpty()) emitEvent("onLiveSeries", mapOf("metrics" to metrics, "generation" to generation()))
    }

    private fun emitFocusedSeries() {
        val metrics = focusedMetrics
        if (metrics.isEmpty()) return
        // One exclusion scan for the whole tick — the spans are identical across metrics.
        val spans = telemetryPipeline.focusedExclusionSpans()
        for (metric in metrics) {
            val focused = telemetryPipeline.focusedSeries(metric, spans) ?: continue
            emitEvent(
                "onFocusedSeries",
                mapOf(
                    "metric" to metric,
                    "series" to focused.series,
                    "exclusions" to focused.exclusions,
                    "windowMs" to focused.windowMs,
                    "spanMs" to focused.spanMs,
                    "sampleRateHz" to focused.sampleRateHz,
                    "generation" to generation(),
                ),
            )
        }
    }
}
