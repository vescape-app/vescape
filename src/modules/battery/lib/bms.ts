import type { BmsEvent, BmsSeriesFrame } from 'vescape-core'

type BmsSnapshot = Pick<BmsEvent, 'cellVoltages' | 'balancing'> & Partial<BmsEvent>

export interface BmsCellGroup {
  index: number
  voltage: number
  balancing: boolean
  /** True for the lowest-voltage group, false for the highest, null otherwise. */
  extreme: 'min' | 'max' | null
}

export interface BmsSummary {
  cellCount: number
  groups: BmsCellGroup[]
  minVoltage: number
  maxVoltage: number
  /** max − min across cell groups. The headline imbalance number. */
  spread: number
  /** Mean cell-group voltage. */
  average: number
  voltageTotal: number
}

export interface BmsWindowStats {
  sampleCount: number
  /** Worst max - min spread seen anywhere in the retained Live BMS Series window. */
  peakSpread: number
  /** Zero-based cell-group index that was lowest most often, tie-broken by depth below average. */
  worstGroupIndex: number | null
  worstGroupSamples: number
  worstGroupDepth: number
}

/** Voltage window that cell bars are drawn over. */
export interface CellBarScale {
  low: number
  high: number
}

// Padding around the pack's min/max so extremes don't pin to the track edges.
const SCALE_PAD_V = 0.008
// Minimum visual span so mV-level noise doesn't read as dramatic imbalance:
// a ~5mV spread stays a few percent of the track, not most of it.
const SCALE_MIN_SPAN_V = 0.12
// Bounds snap to this grid so the scale (and every bar) only shifts when the
// pack actually crosses a step, instead of re-centering on each 1mV wiggle.
const SCALE_STEP_V = 0.02
const EXTREME_EPSILON_V = 0.0005

// Charge-port voltage sits near pack voltage with a charger plugged in and near
// zero otherwise; anything above this floor means a charger is present.
const CHARGE_DETECT_MIN_V = 10

/**
 * Cell-spread severity tiers, mirroring the native `CellSpreadDetector` constants so the readout
 * colours agree with the Board Warning the detector would raise. Spread at or above the warn
 * threshold is a weak or unbalanced pack; at or above the critical threshold it is a fault.
 *
 * @parity /modules/vescape-core/ios/warnings/CellSpreadDetector.swift `warnThresholdV`
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/warnings/CellSpreadDetector.kt `WARN_THRESHOLD_V`
 */
export const CELL_SPREAD_WARN_V = 0.2
export const CELL_SPREAD_CRITICAL_V = 0.5

/** Severity tier for one spread reading. Worklet: the live card colours on the UI thread. */
export function cellSpreadTone(spread: number): 'ok' | 'warn' | 'critical' {
  'worklet'
  if (!Number.isFinite(spread)) return 'ok'
  if (spread >= CELL_SPREAD_CRITICAL_V) return 'critical'
  return spread >= CELL_SPREAD_WARN_V ? 'warn' : 'ok'
}

/** True when the BMS charge-port voltage indicates a connected charger. */
export function isBmsCharging(bms: Pick<BmsEvent, 'vCharge'> | null): boolean {
  return bms != null && Number.isFinite(bms.vCharge) && bms.vCharge > CHARGE_DETECT_MIN_V
}

// summarizeBms and cellBarScale are worklets: the live cell card rebuilds the
// scrubbed summary on the UI thread, so scrubbing never re-renders React.

/**
 * Shared scale for cell bars: the pack's [min, max] padded slightly, snapped
 * outward to a coarse grid for stability, then widened symmetrically to a
 * floor span so near-balanced packs don't amplify noise.
 */
export function cellBarScale(minVoltage: number, maxVoltage: number): CellBarScale {
  'worklet'
  let low = Math.floor((minVoltage - SCALE_PAD_V) / SCALE_STEP_V) * SCALE_STEP_V
  let high = Math.ceil((maxVoltage + SCALE_PAD_V) / SCALE_STEP_V) * SCALE_STEP_V
  while (high - low < SCALE_MIN_SPAN_V - 1e-9) {
    low -= SCALE_STEP_V
    high += SCALE_STEP_V
  }
  return { low, high }
}

/**
 * Reduce a raw BMS snapshot into per-group rows plus pack-level min/max/spread.
 * Returns null when the snapshot carries no usable cell voltages.
 */
export function summarizeBms(bms: BmsSnapshot | null): BmsSummary | null {
  'worklet'
  if (!bms) return null
  const cells = bms.cellVoltages.filter((v) => Number.isFinite(v) && v > 0)
  if (cells.length === 0) return null

  const minVoltage = Math.min(...cells)
  const maxVoltage = Math.max(...cells)
  const average = cells.reduce((sum, v) => sum + v, 0) / cells.length

  // Only tag extremes when there is a real imbalance, otherwise every group at the
  // same voltage would flicker a min/max badge.
  const hasSpread = maxVoltage - minVoltage > EXTREME_EPSILON_V

  const groups: BmsCellGroup[] = bms.cellVoltages.map((voltage, index) => ({
    index,
    voltage,
    balancing: bms.balancing[index] ?? false,
    extreme: !hasSpread
      ? null
      : voltage === minVoltage
        ? 'min'
        : voltage === maxVoltage
          ? 'max'
          : null,
  }))

  return {
    cellCount: cells.length,
    groups,
    minVoltage,
    maxVoltage,
    spread: maxVoltage - minVoltage,
    average,
    voltageTotal: bms.voltageTotal ?? cells.reduce((sum, v) => sum + v, 0),
  }
}

/** Returns the retained BMS frame nearest to `timeMs`; ties choose the previous frame. */
export function nearestBmsFrameAtTime(
  frames: BmsSeriesFrame[],
  timeMs: number | null,
): BmsSeriesFrame | null {
  if (timeMs == null || frames.length === 0) return null
  let lo = 0
  let hi = frames.length - 1
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2)
    if (frames[mid].capturedAt < timeMs) lo = mid + 1
    else hi = mid
  }
  if (lo === 0) return frames[0]
  const prev = lo - 1
  return Math.abs(frames[prev].capturedAt - timeMs) <= Math.abs(frames[lo].capturedAt - timeMs)
    ? frames[prev]
    : frames[lo]
}

/** Reduces the retained Live BMS Series into over-window diagnostics. */
export function summarizeBmsWindow(frames: BmsSeriesFrame[]): BmsWindowStats | null {
  let sampleCount = 0
  let peakSpread = 0
  const groupScores = new Map<number, { samples: number; depth: number }>()

  for (const frame of frames) {
    const summary = summarizeBms(frame)
    if (!summary) continue
    sampleCount += 1
    peakSpread = Math.max(peakSpread, summary.spread)
    if (summary.spread <= EXTREME_EPSILON_V) continue

    for (const group of summary.groups) {
      if (!Number.isFinite(group.voltage) || group.voltage <= 0) continue
      if (Math.abs(group.voltage - summary.minVoltage) > EXTREME_EPSILON_V) continue
      const current = groupScores.get(group.index) ?? { samples: 0, depth: 0 }
      current.samples += 1
      current.depth += Math.max(0, summary.average - group.voltage)
      groupScores.set(group.index, current)
    }
  }

  if (sampleCount === 0) return null

  let worstGroupIndex: number | null = null
  let worstGroupSamples = 0
  let worstGroupDepth = 0
  for (const [index, score] of groupScores) {
    if (
      score.samples > worstGroupSamples ||
      (score.samples === worstGroupSamples && score.depth > worstGroupDepth)
    ) {
      worstGroupIndex = index
      worstGroupSamples = score.samples
      worstGroupDepth = score.depth
    }
  }

  return {
    sampleCount,
    peakSpread,
    worstGroupIndex,
    worstGroupSamples,
    worstGroupDepth,
  }
}
