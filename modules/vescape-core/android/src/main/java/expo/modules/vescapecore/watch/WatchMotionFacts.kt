package expo.modules.vescapecore.watch

/** Measured facts only. Clocks are reconciled at the wrist, never assumed equal.
 * Two Float32 lanes encode each millisecond integer exactly (high * 1048576 + low).
 * @parity /modules/vescape-core/ios/watch/WatchMotionFacts.swift
 */
data class WatchMotionFacts(
    val sourceId: Double, val fixTimestamp: Double, val sentAt: Double,
    val gpsAgeMs: Double, val boardAgeMs: Double, val accuracyM: Double, val clockRate: Double = 1.0,
) {
    fun lanes(): List<Double> = listOf(sourceId, fixTimestamp, sentAt).flatMap {
        listOf(kotlin.math.floor(it / 1048576), it % 1048576)
    } + listOf(gpsAgeMs, boardAgeMs, accuracyM, clockRate)
    companion object {
        const val LANE_COUNT = 10
        fun decode(lanes: List<Double>): WatchMotionFacts? {
            if (lanes.size != LANE_COUNT || lanes.any { !it.isFinite() || it < 0 }) return null
            return WatchMotionFacts(lanes[0] * 1048576 + lanes[1], lanes[2] * 1048576 + lanes[3], lanes[4] * 1048576 + lanes[5], lanes[6], lanes[7], lanes[8], lanes[9].coerceIn(0.1, 100.0))
        }
    }
}

/** Minimum observed receive-send offset removes arbitrary phone/watch clock skew. Later excess
 * delay ages BOTH inputs. The first frame's one-way latency is unknowable without clock sync.
 * @parity /modules/vescape-core/ios/watch/WatchMotionFacts.swift `WatchMotionClock`
 */
class WatchMotionClock {
    private var source = -1.0
    private var lastSent = Double.NEGATIVE_INFINITY
    private var lastReceived = Double.NEGATIVE_INFINITY
    private var lastRate = 1.0
    private var excessDelay = 0.0
    fun accept(facts: WatchMotionFacts, now: Double): Double? {
        if (!now.isFinite() || facts.sourceId < source || (facts.sourceId == source && (facts.sentAt <= lastSent || now < lastReceived))) return null
        if (facts.sourceId > source) { source = facts.sourceId; lastSent = Double.NEGATIVE_INFINITY; excessDelay = 0.0 }
        if (lastSent.isFinite()) {
            val expected = (facts.sentAt - lastSent) / lastRate
            excessDelay = maxOf(0.0, excessDelay + (now - lastReceived) - expected)
        }
        lastSent = facts.sentAt; lastReceived = now; lastRate = facts.clockRate
        return excessDelay
    }
}
