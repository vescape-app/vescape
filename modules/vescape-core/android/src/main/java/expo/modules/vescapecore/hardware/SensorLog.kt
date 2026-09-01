package expo.modules.vescapecore.hardware

import expo.modules.vescapecore.telemetry.LiveSeriesDownsampler

/**
 * A sensor frame as the board pushes it: a flat JSON object of numbers, one key per reading.
 * Unknown keys are kept, so a newly wired sensor shows up without an app release.
 *
 * @parity /../vescape-hardware/src/main.cpp `sensorFrame`
 */
internal data class SensorFrame(val atMs: Long, val values: Map<String, Double>)

/** One chart row, decimated and scaled, ready for the UI to draw without touching the history. */
internal data class SensorSeries(
    val key: String,
    /** Flat `[ts0, v0, ts1, v1, ...]`, the cheapest shape to cross the bridge. */
    val points: DoubleArray,
    val min: Double,
    val max: Double,
)

/** What the link is really doing, as opposed to what the board was asked for. */
internal data class LinkRate(val hz: Double?, val dropped: Int, val readMs: Double?)

/**
 * The board's sensor history, and everything derived from it.
 *
 * This lives natively because the link can push fifty frames a second: parsing, clamping,
 * buffering and decimating that in JS is enough to starve the JS thread on its own, long before
 * any of it is drawn. JS is handed live numbers and a decimated series and renders them.
 *
 * Not thread-safe: every caller runs on the link's handler thread.
 *
 * @parity /src/modules/hardware/lib/sensorRuntime.ts
 */
internal class SensorLog(
    /**
     * How much history the charts show. The board is a live instrument here — what a sensor did
     * half a minute ago is not what anyone is reading it for.
     */
    private val historyMs: Long = 20_000L,
    /** Hard cap, so a board reporting faster than expected cannot grow the buffer without bound. */
    private val maxFrames: Int = 2_000,
) {
    private val frames = ArrayDeque<SensorFrame>()

    /** Keys seen on this link, in the order the board first sent them: the row order on screen. */
    private val keyOrder = mutableListOf<String>()

    /** When each key first carried a value, so a chart knows how far back it may draw. */
    private val firstSeen = mutableMapOf<String, Long>()

    fun keys(): List<String> = keyOrder.toList()

    /**
     * Reads a device notification as a sensor frame and keeps it, or returns false when the text
     * is anything else — echoes, boot chatter, a half-delivered write — which belongs in the
     * console instead.
     */
    fun append(text: String, atMs: Long): Boolean {
        val frame = parseFrame(text, atMs) ?: return false
        frames.addLast(frame)
        // Trimmed by age rather than count: the window is a span of time, whatever rate fills it.
        while (frames.size > maxFrames || (frames.firstOrNull()?.atMs ?: atMs) < atMs - historyMs) {
            frames.removeFirst()
        }
        for (key in frame.values.keys) {
            if (firstSeen.put(key, atMs) == null) keyOrder.add(key)
        }
        return true
    }

    fun clear() {
        frames.clear()
        keyOrder.clear()
        firstSeen.clear()
    }

    /**
     * Latest value per key, in display units, in row order. A key the newest frame did not carry
     * still gets a value — its ceiling — or NaN when it has none: a sensor that stopped answering
     * must not leave a stale number standing.
     */
    fun live(): DoubleArray {
        val latest = frames.lastOrNull()
        return DoubleArray(keyOrder.size) { index ->
            val key = keyOrder[index]
            readingValue(key, latest?.values?.get(key)) ?: Double.NaN
        }
    }

    /**
     * The display range per key, as `[min0, max0, min1, max1, ...]` parallel to the rows, NaN
     * where a reading has no fixed range. A row needs it to draw a value as a proportion rather
     * than a number, and the range is part of the reading contract, not the screen's to guess.
     */
    fun ranges(): DoubleArray {
        val out = DoubleArray(keyOrder.size * 2)
        for (index in keyOrder.indices) {
            val spec = readingSpec(keyOrder[index])
            out[index * 2] = spec.min ?: Double.NaN
            out[index * 2 + 1] = spec.max ?: Double.NaN
        }
        return out
    }

    /**
     * The board stamps every frame with `seq`, so a rate below the requested one can be told apart
     * from notifications the phone dropped: a slow board keeps its sequence intact, a saturated
     * link skips numbers.
     */
    fun rate(): LinkRate {
        val latest = frames.lastOrNull() ?: return LinkRate(null, 0, null)
        val readMs = latest.values["readMs"]
        val cutoff = latest.atMs - RATE_WINDOW_MS
        val window = frames.filter { it.atMs >= cutoff }
        if (window.size < 2) return LinkRate(null, 0, readMs)

        val span = latest.atMs - window.first().atMs
        val hz = if (span > 0L) (window.size - 1) * 1000.0 / span else null

        var dropped = 0
        for (index in 1 until window.size) {
            val previous = window[index - 1].values["seq"] ?: continue
            val current = window[index].values["seq"] ?: continue
            if (current > previous) dropped += (current - previous - 1).toInt()
        }
        return LinkRate(hz, dropped, readMs)
    }

    /**
     * One decimated series per chartable key, in row order.
     *
     * A key missing from a frame is a gap, not a zero: the ToF drops out when nothing is in range,
     * and drawing that as a floor would read as an object right against the sensor. A sensor with
     * a fixed range instead rides its ceiling, so both distance rows keep advancing on the same
     * head — but only once it has answered at least once, so the ceiling never invents history.
     */
    fun series(): List<SensorSeries> {
        val out = mutableListOf<SensorSeries>()
        val oldest = frames.firstOrNull()?.atMs ?: return out
        for (key in keyOrder) {
            val spec = readingSpec(key)
            if (!spec.chart) continue

            val samples = mutableListOf<SensorFrame>()
            val values = mutableListOf<Double>()
            var min = Double.MAX_VALUE
            var max = -Double.MAX_VALUE
            // Answered before this window opened, so the ceiling may fill from its first frame.
            var started = (firstSeen[key] ?: Long.MAX_VALUE) <= oldest
            for (frame in frames) {
                val raw = frame.values[key]
                if (raw == null && !started) continue
                val value = readingValue(key, raw) ?: continue
                started = true
                samples.add(frame)
                values.add(value)
                if (value < min) min = value
                if (value > max) max = value
            }
            if (values.size < 2) continue

            val points = LiveSeriesDownsampler.downsampleMinMax(
                rows = samples.indices.toList(),
                bucketCount = BUCKET_COUNT,
                windowMs = historyMs,
                timestamp = { samples[it].atMs },
                value = { values[it] },
            )
            // A fixed range keeps a distance row on one scale; everything else fits its data.
            val pad = maxOf((max - min) * 0.1, MIN_SPAN / 2)
            out.add(
                SensorSeries(
                    key = key,
                    points = points,
                    min = spec.min ?: (min - pad),
                    max = spec.max ?: (max + pad),
                ),
            )
        }
        return out
    }

    private companion object {
        /** Rate window: short enough to react, long enough not to flicker. */
        const val RATE_WINDOW_MS = 3_000L

        /**
         * Buckets per chart row. A phone chart is a few hundred pixels wide, so beyond this the
         * history is several points per pixel: it costs a redraw and shows nothing extra.
         */
        const val BUCKET_COUNT = 200

        /** Flat series get a readable band rather than an axis collapsed onto one value. */
        const val MIN_SPAN = 1.0
    }
}

/** Flat `"key": number` pairs. Nested objects are not part of the frame contract. */
private val NUMBER_FIELD = Regex("\"([^\"]+)\"\\s*:\\s*(-?\\d+(?:\\.\\d+)?(?:[eE][-+]?\\d+)?)")

internal fun parseFrame(text: String, atMs: Long): SensorFrame? {
    val trimmed = text.trim()
    if (!trimmed.startsWith("{")) return null
    val values = mutableMapOf<String, Double>()
    for (match in NUMBER_FIELD.findAll(trimmed)) {
        val value = match.groupValues[2].toDoubleOrNull() ?: continue
        if (value.isFinite()) values[match.groupValues[1]] = value
    }
    return if (values.isEmpty()) null else SensorFrame(atMs, values)
}
