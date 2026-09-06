export interface BmsSeriesFrame {
  capturedAt: number
  cellVoltages: number[]
  balancing: boolean[]
}

export interface NativeBmsSeriesEvent {
  cellCount: number
  count: number
  columns: ArrayBuffer | Uint8Array
}

/**
 * @parity /modules/vescape-core/ios/telemetry/BmsSeriesRing.swift `BMS_SERIES_FIXED_LANES`
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/BmsSeriesRing.kt `BMS_SERIES_FIXED_LANES`
 */
const BMS_SERIES_FIXED_LANES = 3

/**
 * @parity /modules/vescape-core/ios/telemetry/BmsSeriesRing.swift `BMS_SERIES_BALANCE_LANE_BITS`
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/BmsSeriesRing.kt `BMS_SERIES_BALANCE_LANE_BITS`
 */
const BMS_SERIES_BALANCE_LANE_BITS = 30

const hasLaneBit = (bits: number, bit: number): boolean => Math.floor(bits / 2 ** bit) % 2 === 1

function float64Lanes(columns: ArrayBuffer | Uint8Array): Float64Array {
  if (columns instanceof ArrayBuffer) return new Float64Array(columns)
  return new Float64Array(
    columns.buffer,
    columns.byteOffset,
    Math.floor(columns.byteLength / Float64Array.BYTES_PER_ELEMENT),
  )
}

/**
 * Decode Live BMS Series columnar buffer from native into public domain frames.
 *
 * @parity /modules/vescape-core/ios/telemetry/BmsSeriesRing.swift `encodeBmsSeriesColumns`
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/BmsSeriesRing.kt `encodeBmsSeriesColumns`
 */
export function decodeBmsSeriesFrames(event: NativeBmsSeriesEvent): BmsSeriesFrame[] {
  const { cellCount, count, columns } = event
  if (!count || !cellCount || !columns) return []
  const laneCount = BMS_SERIES_FIXED_LANES + cellCount
  const lanes = float64Lanes(columns)
  const frameCount = Math.min(count, Math.floor(lanes.length / laneCount))
  const frames = new Array<BmsSeriesFrame>(frameCount)
  for (let row = 0; row < frameCount; row++) {
    const o = row * laneCount
    const bitsLo = lanes[o + 1]
    const bitsHi = lanes[o + 2]
    const cellVoltages = new Array<number>(cellCount)
    const balancing = new Array<boolean>(cellCount)
    for (let cell = 0; cell < cellCount; cell++) {
      cellVoltages[cell] = lanes[o + BMS_SERIES_FIXED_LANES + cell]
      balancing[cell] =
        cell < BMS_SERIES_BALANCE_LANE_BITS
          ? hasLaneBit(bitsLo, cell)
          : hasLaneBit(bitsHi, cell - BMS_SERIES_BALANCE_LANE_BITS)
    }
    frames[row] = { capturedAt: lanes[o], cellVoltages, balancing }
  }
  return frames
}
