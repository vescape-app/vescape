import { useEffect, useMemo } from 'react'
import type { TelemetryEvent } from 'vescape-core'

import { acquireFocusedSeries, releaseFocusedSeries } from '@/modules/board/store/bleStore'
import { useLiveSeriesStore } from '@/modules/board/store/liveSeriesStore'
import { useFocusedSeriesStore } from '@/modules/board/store/focusedSeriesStore'
import { type ExcludedRange, toExcludedRanges } from '@/components/charts/chartMath'
import { finite, absolute } from '@/helpers/finite'

export interface LiveMetricPoint {
  ts: number
  value: number
}

export type TelemetrySelector = (sample: TelemetryEvent) => number | null | undefined

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryPipeline.kt `LIVE_SERIES_METRICS`
 * @parity /modules/vescape-core/ios/telemetry/LiveSeriesEmitter.swift `centerMetrics`
 */
export const liveSelectors = {
  speed: (s: TelemetryEvent) => (s.metricExclusions?.max_speed ? null : absolute(s.speed)),
  duty: (s: TelemetryEvent) => {
    if (s.metricExclusions?.max_duty) return null
    const v = absolute(s.dutyCycle)
    return v == null ? null : v * 100
  },
  motorCurrent: (s: TelemetryEvent) => finite(s.motorCurrent),
  batteryCurrent: (s: TelemetryEvent) => finite(s.batteryCurrent),
  batteryVoltage: (s: TelemetryEvent) => finite(s.batteryVoltage),
  batteryPercent: (s: TelemetryEvent) => finite(s.batteryPercent),
  motorTemp: (s: TelemetryEvent) => (s.tempMotor != null && s.tempMotor > 0 ? s.tempMotor : null),
  controllerTemp: (s: TelemetryEvent) => finite(s.tempMosfet),
  footpadAdc1: (s: TelemetryEvent) => finite(s.adc1),
  footpadAdc2: (s: TelemetryEvent) => finite(s.adc2),
  pitch: (s: TelemetryEvent) => finite(s.pitch),
  roll: (s: TelemetryEvent) => finite(s.roll),
  balancePitch: (s: TelemetryEvent) => finite(s.balancePitch),
} as const

/** Reverse map: a `liveSelectors` function → its metric key, matching the native series names. */
const SELECTOR_KEYS = new Map<TelemetrySelector, string>(
  (Object.entries(liveSelectors) as [string, TelemetrySelector][]).map(([key, selector]) => [
    selector,
    key,
  ]),
)

const EMPTY_FLAT: number[] = []
const EMPTY_RANGES: ExcludedRange[] = []

/** Native emits every series flat as `[ts0, v0, ts1, v1, ...]` — the most compact bridge shape. */
function flatToPoints(flat: number[]): LiveMetricPoint[] {
  const points: LiveMetricPoint[] = []
  for (let i = 0; i + 1 < flat.length; i += 2) {
    points.push({ ts: flat[i], value: flat[i + 1] })
  }
  return points
}

/**
 * Center-screen sparkline series: decimated natively (min/max per bucket) and pushed ~1Hz
 * on `onLiveSeries`. `metricKey` matches the native `LIVE_SERIES_METRICS` set. No raw samples
 * cross the bridge and no per-render projection runs.
 */
export function useLiveSeries(metricKey: string): LiveMetricPoint[] {
  const flat = useLiveSeriesStore((s) => s.metrics[metricKey] ?? EMPTY_FLAT)
  return useMemo(() => flatToPoints(flat), [flat])
}

/**
 * Full-resolution live series for a `/control` detail chart. Mounting focuses the metric so
 * native streams it on `onFocusedSeries` at full resolution (20ms buckets, below the packet interval);
 * unmounting releases it so native stops. The center screen never focuses anything, so the
 * high-res stream costs nothing while riding.
 */
export function useLiveMetric(pick: TelemetrySelector): LiveMetricPoint[] {
  const metricKey = SELECTOR_KEYS.get(pick) ?? ''
  if (__DEV__ && !metricKey) {
    console.warn('useLiveMetric: selector must be a `liveSelectors.*` reference, got an unknown fn')
  }
  useEffect(() => {
    if (!metricKey) return
    acquireFocusedSeries(metricKey)
    return () => releaseFocusedSeries(metricKey)
  }, [metricKey])
  const flat = useFocusedSeriesStore((s) => s.series[metricKey] ?? EMPTY_FLAT)
  return useMemo(() => flatToPoints(flat), [flat])
}

/**
 * Overlay bands for a detail chart, rebuilt from the excluded spans riding along with the
 * focused series (flat `[start, end, ...]` per exclusion key). Unions the requested keys, then
 * reuses {@link toExcludedRanges} to merge nearby spans. Reason mirrors the old sample-scan rule:
 * `low_speed` when only `avg_speed` is requested, else `free_spin`.
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryPipeline.kt `excludedSpans`
 */
export function buildFocusedExcludedRanges(
  exclusions: Record<string, number[]>,
  metricKeys: string[],
): ExcludedRange[] {
  const reason =
    metricKeys.length === 1 && metricKeys[0] === 'avg_speed' ? 'low_speed' : 'free_spin'
  const records: Array<{
    startMs: number
    endMs: number
    reason: string
    metrics: Record<string, boolean>
  }> = []
  for (const key of metricKeys) {
    const flat = exclusions[key]
    if (!flat) continue
    for (let i = 0; i + 1 < flat.length; i += 2) {
      records.push({ startMs: flat[i], endMs: flat[i + 1], reason, metrics: { [key]: true } })
    }
  }
  if (records.length === 0) return EMPTY_RANGES
  return toExcludedRanges(records, metricKeys)
}

export function useLiveExcludedRanges(...metricKeys: string[]): ExcludedRange[] {
  const exclusions = useFocusedSeriesStore((s) => s.exclusions)
  const keysKey = metricKeys.join('\0')
  return useMemo(
    () => buildFocusedExcludedRanges(exclusions, keysKey.split('\0')),
    [exclusions, keysKey],
  )
}
