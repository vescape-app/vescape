package expo.modules.vescapecore.accessory

/** Short-lived display history. Control still consumes every original reading.
 * @parity /modules/vescape-core/ios/accessory/ClearancePreviewLog.swift
 * @parity /modules/vescape-core/src/index.ts `ClearancePreviewDiagnostics`
 */
class ClearancePreviewLog {
    private data class Sample(val at: Long, val time: Long, val seq: Long, val value: Double?)
    private val samples = ArrayDeque<Sample>()
    private var emittedAt: Long? = null
    private var chartAt: Long? = null
    fun reset() { samples.clear(); emittedAt = null; chartAt = null }
    fun record(at: Long, time: Long, seq: Long, value: Double?) {
        samples.addLast(Sample(at, time, seq, value))
        while (samples.size > 601 || (samples.firstOrNull()?.at ?: at) < at - 20_000) samples.removeFirst()
    }
    fun shouldEmit(at: Long): Boolean {
        if (emittedAt?.let { at - it < 100 } == true) return false
        emittedAt = at
        return true
    }
    fun snapshot(at: Long): Map<String, Any?>? {
        if (chartAt?.let { at - it < 250 } == true) return null
        chartAt = at
        val segments = mutableListOf<List<Double>>()
        var segment = mutableListOf<Double>()
        var previous: Sample? = null
        var dropped = 0L
        for (sample in samples) {
            val gap = previous?.let { sample.seq != it.seq + 1 || sample.at - it.at > 300 } == true
            previous?.let { dropped += (sample.seq - it.seq - 1).coerceAtLeast(0) }
            if (gap || sample.value == null) {
                if (segment.isNotEmpty()) segments.add(segment)
                segment = mutableListOf()
            }
            sample.value?.let { segment.add(sample.time.toDouble()); segment.add(it) }
            previous = sample
        }
        if (segment.isNotEmpty()) segments.add(segment)
        val span = samples.lastOrNull()?.at?.minus(samples.first().at) ?: 0
        return mapOf(
            "segments" to segments,
            "deliveredHz" to if (span > 0) (samples.size - 1) * 1000.0 / span else 0.0,
            "dropped" to dropped,
            "invalid" to samples.count { it.value == null },
            "samples" to samples.size,
        )
    }
}
