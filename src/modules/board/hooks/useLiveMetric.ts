import { useEffect, useMemo } from 'react'
import type { TelemetryEvent } from 'vescape-core'

import {
  acquireFullSampleStream,
  releaseFullSampleStream,
  useBleStore,
} from '@/modules/board/store/bleStore'
import { useLiveSeriesStore } from '@/modules/board/store/liveSeriesStore'
import type { ExcludedRange } from '@/components/charts/chartMath'
import { finite, absolute } from '@/helpers/finite'
import { liveTelemetryRuntime } from '@/modules/board/lib/liveTelemetryRuntime'

/**
 * TEMPORARY perf switch (https://github.com/KacperKozak/vescape/issues/114).
 *
 * `true`  — `/control` detail charts stream raw full samples (`onTelemetryHistory`
 *           firehose) for full-resolution, scrubbable lines + excluded-range bands.
 * `false` — detail charts read the cheap natively-decimated series (the same path
 *           the center sparklines use). The firehose was overwhelming the JS thread
 *           on lower-end devices, so we trade resolution for a near-zero live cost.
 *
 * We want `true` back once the full-sample path is made cheap — flip this flag (both
 * code paths below are kept compiled so the revert is one line). See the issue.
 */
const LIVE_DETAIL_FULL_RESOLUTION: boolean = false

export interface LiveMetricPoint {
  ts: number
  value: number
}

export type TelemetrySelector = (sample: TelemetryEvent) => number | null | undefined

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

/** Reverse map: a `liveSelectors` function → its key, which matches `LIVE_SERIES_METRICS` natively. */
const SELECTOR_KEYS = new Map<TelemetrySelector, string>(
  (Object.entries(liveSelectors) as [string, TelemetrySelector][]).map(([key, selector]) => [
    selector,
    key,
  ]),
)

const EMPTY: LiveMetricPoint[] = []
const EMPTY_FLAT: number[] = []
const EMPTY_RANGES: ExcludedRange[] = []

// ── Decimated path (active): reads the cheap native series, no firehose ───────────

/**
 * Live metric series, decimated natively (min/max per time bucket) and pushed ~1Hz.
 * `metricKey` matches `LIVE_SERIES_METRICS` on the native side. No raw samples cross
 * the bridge and no per-render projection runs.
 */
export function useLiveSeries(metricKey: string): LiveMetricPoint[] {
  const flat = useLiveSeriesStore((s) => s.metrics[metricKey] ?? EMPTY_FLAT)
  return useMemo(() => {
    const points: LiveMetricPoint[] = []
    for (let i = 0; i + 1 < flat.length; i += 2) {
      points.push({ ts: flat[i], value: flat[i + 1] })
    }
    return points
  }, [flat])
}

function useDecimatedMetric(pick: TelemetrySelector): LiveMetricPoint[] {
  return useLiveSeries(SELECTOR_KEYS.get(pick) ?? '')
}

function useDecimatedExcludedRanges(..._metricKeys: string[]): ExcludedRange[] {
  // The decimated speed/duty series already nulls excluded samples (the line shows
  // gaps), so we drop the labelled overlay bands here. They return with the
  // full-resolution path — see issue #114.
  return EMPTY_RANGES
}

// ── Full-resolution path (parked behind the flag): streams raw full samples ───────

function projectMetric(telemetry: TelemetryEvent[], pick: TelemetrySelector): LiveMetricPoint[] {
  const points: LiveMetricPoint[] = []
  for (const sample of telemetry) {
    const value = pick(sample)
    if (value == null || !Number.isFinite(value)) continue
    points.push({ ts: sample.lastPacketAt, value })
  }
  return points
}

let cachedVersion = -1
const cache = new Map<TelemetrySelector, LiveMetricPoint[]>()

function getOrProject(version: number, pick: TelemetrySelector): LiveMetricPoint[] {
  if (version !== cachedVersion) {
    cache.clear()
    cachedVersion = version
  }
  let result = cache.get(pick)
  if (!result) {
    const telemetry = liveTelemetryRuntime.getTelemetry()
    if (telemetry.length === 0) return EMPTY
    result = projectMetric(telemetry, pick)
    cache.set(pick, result)
  }
  return result
}

/**
 * Ref-counts the native full-sample stream so it only runs while a detail chart
 * is mounted. On the center screen nothing acquires it, so native stops emitting
 * the raw `onTelemetryHistory` firehose entirely.
 */
function useFullSampleStream(): void {
  useEffect(() => {
    acquireFullSampleStream()
    return releaseFullSampleStream
  }, [])
}

function useFullResolutionMetric(pick: TelemetrySelector): LiveMetricPoint[] {
  useFullSampleStream()
  const version = useBleStore((s) => s.metricVersion)
  return useMemo(() => getOrProject(version, pick), [version, pick])
}

function buildLiveExcludedRanges(
  telemetry: TelemetryEvent[],
  metricKeys: string[],
  mergeGapMs = 2000,
): ExcludedRange[] {
  const metricKeySet = new Set(metricKeys)
  const hasSpeedOnly = metricKeySet.has('avg_speed') && metricKeySet.size === 1
  const reason = hasSpeedOnly ? 'low_speed' : 'free_spin'
  const ranges: ExcludedRange[] = []
  for (const s of telemetry) {
    if (!metricKeys.some((k) => s.metricExclusions?.[k])) continue
    const last = ranges.at(-1)
    if (last && last.reason === reason && s.lastPacketAt - last.endMs <= mergeGapMs) {
      last.endMs = s.lastPacketAt
    } else {
      ranges.push({ startMs: s.lastPacketAt, endMs: s.lastPacketAt, reason })
    }
  }
  return ranges
}

function useFullResolutionExcludedRanges(...metricKeys: string[]): ExcludedRange[] {
  useFullSampleStream()
  const version = useBleStore((s) => s.metricVersion)
  const keysKey = metricKeys.join('\0')
  return useMemo(() => {
    const telemetry = liveTelemetryRuntime.getTelemetry()
    return buildLiveExcludedRanges(telemetry, keysKey.split('\0'))
    // `version` is the recompute trigger (new samples bump it); the body reads the
    // mutable runtime buffer directly, so it isn't referenced here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, keysKey])
}

// ── Public hooks: bound to one path at module load (no conditional hook calls) ────

/**
 * Live metric series for the `/control` detail charts. Backed by either the
 * full-sample firehose or the decimated native series — see {@link LIVE_DETAIL_FULL_RESOLUTION}.
 */
export const useLiveMetric: (pick: TelemetrySelector) => LiveMetricPoint[] =
  LIVE_DETAIL_FULL_RESOLUTION ? useFullResolutionMetric : useDecimatedMetric

export const useLiveExcludedRanges: (...metricKeys: string[]) => ExcludedRange[] =
  LIVE_DETAIL_FULL_RESOLUTION ? useFullResolutionExcludedRanges : useDecimatedExcludedRanges
