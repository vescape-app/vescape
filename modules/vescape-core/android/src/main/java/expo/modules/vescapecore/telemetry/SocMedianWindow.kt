package expo.modules.vescapecore.telemetry

import kotlin.math.roundToInt

/**
 * @parity /modules/vescape-core/ios/telemetry/SocMedianWindow.swift
 */
class SocMedianWindow(@Volatile var windowMs: Long = 20_000L) {
    private data class Sample(val tMs: Long, val bucket: Int)

    private val samples = ArrayDeque<Sample>()
    private val bucketCounts = IntArray(BUCKET_COUNT)
    private var sampleCount = 0

    fun reset() {
        samples.clear()
        bucketCounts.fill(0)
        sampleCount = 0
    }

    fun median(percent: Double, nowMs: Long): Double {
        if (windowMs <= 0L) {
            reset()
            return percent
        }
        val bucket = percentBucket(percent)
        samples.addLast(Sample(nowMs, bucket))
        bucketCounts[bucket] += 1
        sampleCount += 1
        while (samples.size > 1 && nowMs - samples.first().tMs > windowMs) {
            val expired = samples.removeFirst()
            bucketCounts[expired.bucket] -= 1
            sampleCount -= 1
        }
        val mid = sampleCount / 2
        return if (sampleCount % 2 == 1) {
            bucketPercent(bucketAtRank(mid))
        } else {
            (bucketPercent(bucketAtRank(mid - 1)) + bucketPercent(bucketAtRank(mid))) / 2.0
        }
    }

    private fun bucketAtRank(rank: Int): Int {
        var seen = 0
        for (bucket in bucketCounts.indices) {
            seen += bucketCounts[bucket]
            if (seen > rank) return bucket
        }
        return MAX_BUCKET
    }

    private fun percentBucket(percent: Double): Int =
        (percent * BUCKET_SCALE).roundToInt().coerceIn(0, MAX_BUCKET)

    private fun bucketPercent(bucket: Int): Double = bucket.toDouble() / BUCKET_SCALE

    companion object {
        private const val BUCKET_SCALE = 10
        private const val MAX_BUCKET = 100 * BUCKET_SCALE
        private const val BUCKET_COUNT = MAX_BUCKET + 1
    }
}
