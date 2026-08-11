package expo.modules.vescapecore.telemetry
import expo.modules.vescapecore.runtime.BoardSession
import expo.modules.vescapecore.runtime.Cancellable
import expo.modules.vescapecore.runtime.Scheduler
import expo.modules.vescapecore.runtime.postDelayedForSession

/** One display frame — the fastest an emit can usefully arrive. @see LiveSeriesEmitter.scaled */
private const val MIN_EMIT_INTERVAL_MS = 16L

internal class LiveSeriesEmitter(
    private val scheduler: Scheduler,
    private val emitEvent: (String, Map<String, Any?>) -> Unit,
    private val telemetryPipeline: TelemetryPipeline,
    private val session: () -> BoardSession?,
    private val isCurrentSession: (BoardSession) -> Boolean,
    private val generation: () -> Long,
    private val historyFlushIntervalMs: Long,
    private val liveSeriesIntervalMs: Long,
    private val liveSeriesBuckets: Int,
    /** @see scaled */
    private val speed: () -> Double = { 1.0 },
) {
    private val historyLock = Any()
    private val historySamples = ArrayDeque<Map<String, Any?>>()
    private var historyFlushHandle: Cancellable? = null
    private var liveSeriesHandle: Cancellable? = null
    private var liveSeriesPrimed = false

    fun enqueueHistorySample(sample: Map<String, Any?>) = synchronized(historyLock) {
        historySamples.addLast(sample)
    }

    fun start() {
        if (historyFlushHandle == null) scheduleHistoryFlush()
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

    fun stop() {
        historyFlushHandle?.cancel()
        historyFlushHandle = null
        flushHistorySamples()
        synchronized(historyLock) { historySamples.clear() }
        liveSeriesHandle?.cancel()
        liveSeriesHandle = null
        liveSeriesPrimed = false
    }

    /**
     * Both intervals are wall-clock throttles on bridge traffic, not descriptions of the ride, so
     * they stay on wall time. What they do have to track is the *rate* of the data feeding them: a
     * replay warming up delivers a minute of ride every couple of seconds, and a fixed 300ms timer
     * would hand JS that minute in a handful of enormous batches — the charts jump rather than
     * fast-forward. Dividing by the session speed keeps each batch the size it would be live.
     *
     * Floored at one display frame: emitting faster than the screen refreshes is pure waste, and it
     * bounds the cost of an extreme speed.
     */
    private fun scaled(intervalMs: Long): Long {
        val currentSpeed = speed()
        if (currentSpeed <= 1.0) return intervalMs
        return maxOf(MIN_EMIT_INTERVAL_MS, (intervalMs / currentSpeed).toLong())
    }

    private fun scheduleHistoryFlush() {
        val token = session() ?: return
        historyFlushHandle = scheduler.postDelayedForSession(token, scaled(historyFlushIntervalMs), isCurrentSession) {
            flushHistorySamples()
            scheduleHistoryFlush()
        }
    }

    private fun flushHistorySamples() {
        val batch = synchronized(historyLock) {
            if (historySamples.isEmpty()) return
            historySamples.toList().also { historySamples.clear() }
        }
        emitEvent("onTelemetryHistory", mapOf("samples" to batch))
    }

    private fun scheduleLiveSeries() {
        val token = session() ?: return
        liveSeriesHandle = scheduler.postDelayedForSession(token, scaled(liveSeriesIntervalMs), isCurrentSession) {
            emitLiveSeries()
            scheduleLiveSeries()
        }
    }

    private fun emitLiveSeries() {
        val metrics = telemetryPipeline.liveSeries(LIVE_SERIES_METRICS, liveSeriesBuckets)
        if (metrics.isNotEmpty()) emitEvent("onLiveSeries", mapOf("metrics" to metrics, "generation" to generation()))
    }
}
