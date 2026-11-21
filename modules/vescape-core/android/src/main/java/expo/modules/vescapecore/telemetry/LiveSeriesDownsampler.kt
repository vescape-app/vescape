package expo.modules.vescapecore.telemetry

/**
 * @parity /modules/vescape-core/ios/telemetry/LiveSeriesDownsampler.swift
 */
object LiveSeriesDownsampler {
    fun <T> downsampleMinMax(
        rows: List<T>,
        bucketCount: Int,
        windowMs: Long,
        timestamp: (T) -> Long,
        value: (T) -> Double?,
    ): DoubleArray {
        if (rows.isEmpty() || bucketCount <= 0 || windowMs <= 0L) return EMPTY

        val bucketWidth = windowMs.toDouble() / bucketCount
        val out = ArrayList<Double>(minOf(rows.size, bucketCount * 2) * 2)
        var bucketIndex = Long.MIN_VALUE
        var minTs = 0L
        var minV = Double.NaN
        var maxTs = 0L
        var maxV = Double.NaN
        var bucketHasData = false

        for (row in rows) {
            val v = value(row) ?: continue
            if (!v.isFinite()) continue
            val ts = timestamp(row)
            val bucket = (ts / bucketWidth).toLong()

            if (bucket != bucketIndex) {
                if (bucketHasData) flush(out, minTs, minV, maxTs, maxV)
                bucketHasData = false
                bucketIndex = bucket
            }

            if (!bucketHasData || v < minV) { minV = v; minTs = ts }
            if (!bucketHasData || v > maxV) { maxV = v; maxTs = ts }
            bucketHasData = true
        }

        if (bucketHasData) flush(out, minTs, minV, maxTs, maxV)
        return out.toDoubleArray()
    }

    private fun flush(out: ArrayList<Double>, minTs: Long, minV: Double, maxTs: Long, maxV: Double) {
        when {
            minTs == maxTs && minV == maxV -> { out.add(minTs.toDouble()); out.add(minV) }
            minTs <= maxTs -> { out.add(minTs.toDouble()); out.add(minV); out.add(maxTs.toDouble()); out.add(maxV) }
            else -> { out.add(maxTs.toDouble()); out.add(maxV); out.add(minTs.toDouble()); out.add(minV) }
        }
    }

    private val EMPTY = DoubleArray(0)
}
