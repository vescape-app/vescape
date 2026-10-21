package expo.modules.vescapecore.telemetry

import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * Fixed lanes preceding the per-cell voltage lanes in the columnar BMS series payload.
 *
 * @parity /modules/vescape-core/ios/telemetry/BmsSeriesRing.swift `BMS_SERIES_FIXED_LANES`
 * @parity /modules/vescape-core/src/bmsSeries.ts `BMS_SERIES_FIXED_LANES`
 */
internal const val BMS_SERIES_FIXED_LANES = 3

/** Bits per balancing lane. Cell counts go up to 60 and a Float64 only holds 53 exact integer
 *  bits, so the balancing bitmask is split across two lanes of 30 bits each.
 *
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
 * Live BMS Series retention: an in-memory per-cell-group voltage/balancing ring covering the
 * recent live-telemetry window (`liveHistoryLimit`). Fed from the existing ~4Hz `onBms` frames —
 * retention runs for the whole Board Session regardless of what JS is showing; only the bridge
 * push is gated by battery-detail focus. Never persisted; cleared with the Board Session.
 *
 * Appends arrive on the BLE/session thread while snapshots are taken from the JS thread on the
 * focus intent, so all access is synchronized.
 *
 * @parity /modules/vescape-core/ios/telemetry/BmsSeriesRing.swift
 */
internal class BmsSeriesRing {
    private val frames = ArrayDeque<BmsSeriesFrame>()
    private var cellCount = 0

    /**
     * Appends one BMS frame and prunes to [windowMs]. A cell-count change (different BMS on
     * reconnect hardware, firmware quirk) resets the ring — mixed-width frames can't share one
     * columnar layout. Returns the stored frame, or null when the frame carries no cells.
     */
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

    /** Windowed copy for the focus-time snapshot push. */
    @Synchronized
    fun snapshot(windowMs: Long, nowMs: Long): List<BmsSeriesFrame> {
        val oldest = nowMs - windowMs
        return frames.filter { it.capturedAtMs >= oldest }
    }

    @Synchronized
    fun cellCount(): Int = cellCount
}

/**
 * Columnar binary encoding of BMS series frames for the bridge push (ADR-0018): each frame is
 * `BMS_SERIES_FIXED_LANES + cellCount` little-endian Float64 lanes, row-major —
 * `[capturedAtMs, balanceBitsLo, balanceBitsHi, v0..v{cellCount-1}]`. Decoded by
 * `decodeBmsSeriesFrames` in `modules/vescape-core/src/index.ts`; lane order is shared by convention.
 *
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
