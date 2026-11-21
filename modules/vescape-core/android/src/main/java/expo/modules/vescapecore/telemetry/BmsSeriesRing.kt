package expo.modules.vescapecore.telemetry

import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * @parity /modules/vescape-core/ios/telemetry/BmsSeriesRing.swift `BMS_SERIES_FIXED_LANES`
 * @parity /modules/vescape-core/src/bmsSeries.ts `BMS_SERIES_FIXED_LANES`
 */
internal const val BMS_SERIES_FIXED_LANES = 3

/**
 * @parity /modules/vescape-core/ios/telemetry/BmsSeriesRing.swift `BMS_SERIES_BALANCE_LANE_BITS`
 * @parity /modules/vescape-core/src/bmsSeries.ts `BMS_SERIES_BALANCE_LANE_BITS`
 */
internal const val BMS_SERIES_BALANCE_LANE_BITS = 30

internal class BmsSeriesFrame(
    val capturedAtMs: Long,
    val cellVoltages: DoubleArray,
    val balancing: BooleanArray,
)

/**
 * @parity /modules/vescape-core/ios/telemetry/BmsSeriesRing.swift
 */
internal class BmsSeriesRing {
    private val frames = ArrayDeque<BmsSeriesFrame>()
    private var cellCount = 0

    @Synchronized
    fun append(
        capturedAtMs: Long,
        cellVoltages: List<Double>,
        balancing: List<Boolean>,
        windowMs: Long,
    ): BmsSeriesFrame? {
        if (cellVoltages.isEmpty()) return null
        if (cellVoltages.size != cellCount) {
            frames.clear()
            cellCount = cellVoltages.size
        }
        val frame = BmsSeriesFrame(
            capturedAtMs = capturedAtMs,
            cellVoltages = cellVoltages.toDoubleArray(),
            balancing = BooleanArray(cellCount) { balancing.getOrElse(it) { false } },
        )
        frames.addLast(frame)
        val oldest = capturedAtMs - windowMs
        while (frames.isNotEmpty() && frames.first().capturedAtMs < oldest) {
            frames.removeFirst()
        }
        return frame
    }

    @Synchronized
    fun clear() {
        frames.clear()
        cellCount = 0
    }

    @Synchronized
    fun snapshot(windowMs: Long, nowMs: Long): List<BmsSeriesFrame> {
        val oldest = nowMs - windowMs
        return frames.filter { it.capturedAtMs >= oldest }
    }

    @Synchronized
    fun cellCount(): Int = cellCount
}

/**
 * @parity /modules/vescape-core/ios/telemetry/BmsSeriesRing.swift `encodeBmsSeriesColumns`
 * @parity /modules/vescape-core/src/index.ts `decodeBmsSeriesFrames`
 */
internal fun encodeBmsSeriesColumns(frames: List<BmsSeriesFrame>, cellCount: Int): ByteBuffer {
    val laneCount = BMS_SERIES_FIXED_LANES + cellCount
    val buffer = ByteBuffer
        .allocateDirect(frames.size * laneCount * 8)
        .order(ByteOrder.LITTLE_ENDIAN)
    for (frame in frames) {
        var bitsLo = 0L
        var bitsHi = 0L
        frame.balancing.forEachIndexed { i, balancing ->
            if (!balancing) return@forEachIndexed
            if (i < BMS_SERIES_BALANCE_LANE_BITS) bitsLo = bitsLo or (1L shl i)
            else bitsHi = bitsHi or (1L shl (i - BMS_SERIES_BALANCE_LANE_BITS))
        }
        buffer
            .putDouble(frame.capturedAtMs.toDouble())
            .putDouble(bitsLo.toDouble())
            .putDouble(bitsHi.toDouble())
        for (i in 0 until cellCount) {
            buffer.putDouble(frame.cellVoltages.getOrElse(i) { Double.NaN })
        }
    }
    buffer.flip()
    return buffer
}
