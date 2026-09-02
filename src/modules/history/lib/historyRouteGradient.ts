import type { LineLayerStyle } from '@rnmapbox/maps'

import { theme } from '@/constants/theme'
import type { ResolvedTelemetryColors } from '@/constants/theme'
import { distanceMeters } from '@/helpers/mapGeometry'
import { routeDistanceProgress } from '@/modules/history/lib/routeProgress'
import {
  getHistoryMetricColorRange,
  getMetricRampColor,
  getTelemetrySampleMetricValue,
  type HistoryMetricHotRanges,
  type HistoryMetricKey,
} from '@/modules/history/lib/metricColorScale'
import type { HistoryGpsSample, TelemetrySample } from '@/modules/history/store/historyStore'

const HISTORY_ROUTE_HIGHLIGHT_WIDTH = 0.24
const HISTORY_ROUTE_HIGHLIGHT_COLOR = theme.alpha(theme.palette.mono.white, 0.85)
const HISTORY_ROUTE_HIGHLIGHT_TRANSPARENT = theme.alpha(theme.palette.mono.white, 0)
const HISTORY_ROUTE_HIGHLIGHT_MIN_DURATION_MS = 1400
const HISTORY_ROUTE_HIGHLIGHT_MAX_DURATION_MS = 5200
const HISTORY_ROUTE_HIGHLIGHT_MS_PER_KM = 260

export function getHistoryRouteHighlightGradient(
  progress: number,
): NonNullable<LineLayerStyle['lineGradient']> {
  const peak = -HISTORY_ROUTE_HIGHLIGHT_WIDTH + progress * (1 + HISTORY_ROUTE_HIGHLIGHT_WIDTH * 2)
  const leadingEdge = Math.max(0, peak - HISTORY_ROUTE_HIGHLIGHT_WIDTH)
  const trailingEdge = Math.min(1, peak + HISTORY_ROUTE_HIGHLIGHT_WIDTH)

  if (peak <= 0) {
    if (trailingEdge <= 0) {
      return [
        'interpolate',
        ['linear'],
        ['line-progress'],
        0,
        HISTORY_ROUTE_HIGHLIGHT_TRANSPARENT,
        1,
        HISTORY_ROUTE_HIGHLIGHT_TRANSPARENT,
      ] as unknown as NonNullable<LineLayerStyle['lineGradient']>
    }
    return [
      'interpolate',
      ['linear'],
      ['line-progress'],
      0,
      HISTORY_ROUTE_HIGHLIGHT_COLOR,
      trailingEdge,
      HISTORY_ROUTE_HIGHLIGHT_TRANSPARENT,
      1,
      HISTORY_ROUTE_HIGHLIGHT_TRANSPARENT,
    ] as unknown as NonNullable<LineLayerStyle['lineGradient']>
  }

  if (peak >= 1) {
    if (leadingEdge >= 1) {
      return [
        'interpolate',
        ['linear'],
        ['line-progress'],
        0,
        HISTORY_ROUTE_HIGHLIGHT_TRANSPARENT,
        1,
        HISTORY_ROUTE_HIGHLIGHT_TRANSPARENT,
      ] as unknown as NonNullable<LineLayerStyle['lineGradient']>
    }
    return [
      'interpolate',
      ['linear'],
      ['line-progress'],
      0,
      HISTORY_ROUTE_HIGHLIGHT_TRANSPARENT,
      leadingEdge,
      HISTORY_ROUTE_HIGHLIGHT_TRANSPARENT,
      1,
      HISTORY_ROUTE_HIGHLIGHT_COLOR,
    ] as unknown as NonNullable<LineLayerStyle['lineGradient']>
  }

  if (leadingEdge <= 0) {
    return [
      'interpolate',
      ['linear'],
      ['line-progress'],
      0,
      HISTORY_ROUTE_HIGHLIGHT_TRANSPARENT,
      peak,
      HISTORY_ROUTE_HIGHLIGHT_COLOR,
      trailingEdge,
      HISTORY_ROUTE_HIGHLIGHT_TRANSPARENT,
      1,
      HISTORY_ROUTE_HIGHLIGHT_TRANSPARENT,
    ] as unknown as NonNullable<LineLayerStyle['lineGradient']>
  }

  if (trailingEdge >= 1) {
    return [
      'interpolate',
      ['linear'],
      ['line-progress'],
      0,
      HISTORY_ROUTE_HIGHLIGHT_TRANSPARENT,
      leadingEdge,
      HISTORY_ROUTE_HIGHLIGHT_TRANSPARENT,
      peak,
      HISTORY_ROUTE_HIGHLIGHT_COLOR,
      1,
      HISTORY_ROUTE_HIGHLIGHT_TRANSPARENT,
    ] as unknown as NonNullable<LineLayerStyle['lineGradient']>
  }

  return [
    'interpolate',
    ['linear'],
    ['line-progress'],
    0,
    HISTORY_ROUTE_HIGHLIGHT_TRANSPARENT,
    leadingEdge,
    HISTORY_ROUTE_HIGHLIGHT_TRANSPARENT,
    peak,
    HISTORY_ROUTE_HIGHLIGHT_COLOR,
    trailingEdge,
    HISTORY_ROUTE_HIGHLIGHT_TRANSPARENT,
    1,
    HISTORY_ROUTE_HIGHLIGHT_TRANSPARENT,
  ] as unknown as NonNullable<LineLayerStyle['lineGradient']>
}

export function getHistoryMetricBaseColor(
  metric: HistoryMetricKey,
  colors: ResolvedTelemetryColors,
): string {
  switch (metric) {
    case 'speed':
      return colors.speed
    case 'duty':
      return colors.duty
    case 'battery':
      return colors.battVoltage
    case 'tempMotor':
      return colors.motorTemp
    case 'tempController':
      return colors.controllerTemp
    case 'motorCurrent':
      return colors.motorCurrent
    case 'batteryCurrent':
      return colors.battCurrent
  }
}

function getNearestTelemetrySample(
  samples: readonly TelemetrySample[],
  targetMs: number,
): TelemetrySample | null {
  if (samples.length === 0) return null
  let lo = 0
  let hi = samples.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const at = samples[mid].capturedAtMs
    if (at === targetMs) return samples[mid]
    if (at < targetMs) lo = mid + 1
    else hi = mid - 1
  }
  if (hi < 0) return samples[0]
  if (lo >= samples.length) return samples[samples.length - 1]
  const before = samples[hi]
  const after = samples[lo]
  return targetMs - before.capturedAtMs <= after.capturedAtMs - targetMs ? before : after
}

function advanceNearestTelemetryIndex(
  samples: readonly TelemetrySample[],
  currentIndex: number,
  targetMs: number,
): number {
  let index = Math.max(0, Math.min(currentIndex, samples.length - 1))
  while (
    index + 1 < samples.length &&
    Math.abs(samples[index + 1].capturedAtMs - targetMs) <=
      Math.abs(samples[index].capturedAtMs - targetMs)
  ) {
    index += 1
  }
  return index
}

export function getHistoryRouteMetricGradient({
  gpsSamples,
  telemetrySamples,
  metric,
  hotRanges,
  gradientsEnabled,
  colors,
  hotColor,
}: {
  gpsSamples: readonly HistoryGpsSample[]
  telemetrySamples: readonly TelemetrySample[]
  metric: HistoryMetricKey
  hotRanges: HistoryMetricHotRanges
  gradientsEnabled: boolean
  colors: ResolvedTelemetryColors
  hotColor: string
}): NonNullable<LineLayerStyle['lineGradient']> | null {
  if (gpsSamples.length < 2 || telemetrySamples.length === 0) return null
  const baseColor = getHistoryMetricBaseColor(metric, colors)
  const range = getHistoryMetricColorRange(metric, baseColor, hotRanges, gradientsEnabled, hotColor)
  if (!range) return null

  const lastIndex = gpsSamples.length - 1
  const routeProgress = routeDistanceProgress(gpsSamples)
  const maxStops = 160
  const step = Math.max(1, Math.floor(lastIndex / (maxStops - 1)))
  const expression: unknown[] = ['interpolate', ['linear'], ['line-progress']]

  let lastProgress = -1
  let telemetryIndex = 0
  for (let index = 0; index < gpsSamples.length; index += step) {
    const gpsSample = gpsSamples[index]
    telemetryIndex = advanceNearestTelemetryIndex(
      telemetrySamples,
      telemetryIndex,
      gpsSample.capturedAtMs,
    )
    const telemetrySample = telemetrySamples[telemetryIndex]
    const value = telemetrySample ? getTelemetrySampleMetricValue(telemetrySample, metric) : null
    const previousStop = expression.at(-2)
    const previousProgress = typeof previousStop === 'number' ? previousStop : -1
    lastProgress = routeProgress[index] ?? 0
    if (lastProgress <= previousProgress) continue
    expression.push(lastProgress, value == null ? baseColor : getMetricRampColor(value, range))
  }

  if (lastProgress < 1) {
    const lastGpsSample = gpsSamples[lastIndex]
    const lastTelemetrySample = getNearestTelemetrySample(
      telemetrySamples,
      lastGpsSample.capturedAtMs,
    )
    const lastValue = lastTelemetrySample
      ? getTelemetrySampleMetricValue(lastTelemetrySample, metric)
      : null
    expression.push(1, lastValue == null ? baseColor : getMetricRampColor(lastValue, range))
  }

  return expression as unknown as NonNullable<LineLayerStyle['lineGradient']>
}

export function getHistoryRouteHighlightDurationMs(route: [number, number][]) {
  if (route.length < 2) return HISTORY_ROUTE_HIGHLIGHT_MIN_DURATION_MS
  let distanceM = 0
  for (let index = 1; index < route.length; index += 1) {
    const [fromLongitude, fromLatitude] = route[index - 1]
    const [toLongitude, toLatitude] = route[index]
    distanceM += distanceMeters(
      { longitude: fromLongitude, latitude: fromLatitude },
      { longitude: toLongitude, latitude: toLatitude },
    )
  }
  return Math.min(
    HISTORY_ROUTE_HIGHLIGHT_MAX_DURATION_MS,
    Math.max(
      HISTORY_ROUTE_HIGHLIGHT_MIN_DURATION_MS,
      (distanceM / 1000) * HISTORY_ROUTE_HIGHLIGHT_MS_PER_KM,
    ),
  )
}
