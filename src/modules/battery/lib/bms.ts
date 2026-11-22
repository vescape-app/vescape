import type { BmsEvent, BmsSeriesFrame } from 'vescape-core'

type BmsSnapshot = Pick<BmsEvent, 'cellVoltages' | 'balancing'> & Partial<BmsEvent>

export interface BmsCellGroup {
  index: number
  voltage: number
  balancing: boolean
  extreme: 'min' | 'max' | null
}

export interface BmsSummary {
  cellCount: number
  groups: BmsCellGroup[]
  minVoltage: number
  maxVoltage: number
  spread: number
  average: number
  voltageTotal: number
}

export interface BmsWindowStats {
  sampleCount: number
  peakSpread: number
  worstGroupIndex: number | null
  worstGroupSamples: number
  worstGroupDepth: number
}

export interface CellBarScale {
  low: number
  high: number
}

const SCALE_PAD_V = 0.008
const SCALE_MIN_SPAN_V = 0.12
const SCALE_STEP_V = 0.02
const EXTREME_EPSILON_V = 0.0005

const CHARGE_DETECT_MIN_V = 10

/**
 * @parity /modules/vescape-core/ios/warnings/CellSpreadDetector.swift `warnThresholdV`
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/warnings/CellSpreadDetector.kt `WARN_THRESHOLD_V`
 */
export const CELL_SPREAD_WARN_V = 0.2
export const CELL_SPREAD_CRITICAL_V = 0.5

export function cellSpreadTone(spread: number): 'ok' | 'warn' | 'critical' {
  'worklet'
  if (!Number.isFinite(spread)) return 'ok'
  if (spread >= CELL_SPREAD_CRITICAL_V) return 'critical'
  return spread >= CELL_SPREAD_WARN_V ? 'warn' : 'ok'
}

export function isBmsCharging(bms: Pick<BmsEvent, 'vCharge'> | null): boolean {
  return bms != null && Number.isFinite(bms.vCharge) && bms.vCharge > CHARGE_DETECT_MIN_V
}

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

export function summarizeBms(bms: BmsSnapshot | null): BmsSummary | null {
  'worklet'
  if (!bms) return null
  const cells = bms.cellVoltages.filter((v) => Number.isFinite(v) && v > 0)
  if (cells.length === 0) return null

  const minVoltage = Math.min(...cells)
  const maxVoltage = Math.max(...cells)
  const average = cells.reduce((sum, v) => sum + v, 0) / cells.length

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
