import { HISTORY_ENDPOINT_LAYER_ID } from '@/modules/history/lib/historyMapLayers'
import { LineLayer, ShapeSource, type LineLayerStyle } from '@rnmapbox/maps'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAnimatedReaction } from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'

import type { ChartTimeRange } from '@/components/charts/line/types'
import { theme } from '@/constants/theme'
import { zoomWindowMs } from '@/modules/history/lib/chartFocus'
import {
  getHistoryMetricBaseColor,
  getHistoryRouteMetricGradient,
} from '@/modules/history/lib/historyRouteGradient'
import type {
  HistoryMetricHotRanges,
  HistoryMetricKey,
} from '@/modules/history/lib/metricColorScale'
import {
  progressAtTime,
  routeTimeProgress,
  type RouteTimeProgress,
} from '@/modules/history/lib/routeProgress'
import type { HistoryGpsSample, TelemetrySample } from '@/modules/history/store/historyStore'
import { useResolvedAccentColors, useResolvedTelemetryColors } from '@/hooks/useTheme'

const DIM_COLOR = theme.alpha(theme.palette.slate.bg, 0.75)
const CLEAR_COLOR = theme.alpha(theme.palette.slate.bg, 0)
const FADE = 0.004
const REFRESH_MS = 80
const DIM_WIDTH = 6
const STOP_EPSILON = 1e-6

interface RouteZoomFocusProps {
  rideGpsSamples: HistoryGpsSample[]
  routeShape: GeoJSON.Feature<GeoJSON.LineString> | null
  rideTelemetrySamples: TelemetrySample[]
  metric: HistoryMetricKey
  hotRanges: HistoryMetricHotRanges
  gradientsEnabled: boolean
  highContrastRoutes: boolean
}

export function RouteZoomFocus({
  rideGpsSamples,
  routeShape,
  rideTelemetrySamples,
  metric,
  hotRanges,
  gradientsEnabled,
  highContrastRoutes,
}: RouteZoomFocusProps) {
  const accents = useResolvedAccentColors()
  const telemetryColors = useResolvedTelemetryColors()
  const [window, setWindow] = useState<ChartTimeRange | null>(null)
  const lastAppliedAt = useRef(0)
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null)

  const progress = useMemo(() => routeTimeProgress(rideGpsSamples), [rideGpsSamples])

  const apply = useCallback((next: ChartTimeRange | null) => {
    const flush = () => {
      lastAppliedAt.current = Date.now()
      pending.current = null
      setWindow(next)
    }
    if (pending.current) clearTimeout(pending.current)
    const elapsed = Date.now() - lastAppliedAt.current
    if (elapsed >= REFRESH_MS) {
      flush()
      return
    }
    pending.current = setTimeout(flush, REFRESH_MS - elapsed)
  }, [])

  useEffect(() => () => clearTimeout(pending.current ?? undefined), [])

  useAnimatedReaction(
    () => zoomWindowMs.value,
    (next) => {
      'worklet'
      scheduleOnRN(apply, next)
    },
    [apply],
  )

  const gradient = useMemo(
    () => (window == null ? null : dimOutsideGradient(window, progress)),
    [progress, window],
  )

  const focus = useMemo(() => {
    if (window == null) return null
    const lo = Math.min(window.startMs, window.endMs)
    const hi = Math.max(window.startMs, window.endMs)
    const coordinates: [number, number][] = []
    const samples: HistoryGpsSample[] = []
    for (const gps of rideGpsSamples) {
      if (gps.capturedAtMs < lo) continue
      if (gps.capturedAtMs > hi) break
      coordinates.push([gps.longitude, gps.latitude])
      samples.push(gps)
    }
    if (coordinates.length < 2) return null
    return {
      shape: {
        type: 'Feature',
        geometry: { type: 'LineString', coordinates },
        properties: {},
      } as GeoJSON.Feature<GeoJSON.LineString>,
      gradient: getHistoryRouteMetricGradient({
        gpsSamples: samples,
        telemetrySamples: rideTelemetrySamples,
        metric,
        hotRanges,
        gradientsEnabled,
        colors: telemetryColors,
        hotColor: accents.red.color,
      }),
    }
  }, [
    accents.red.color,
    gradientsEnabled,
    hotRanges,
    metric,
    rideGpsSamples,
    rideTelemetrySamples,
    telemetryColors,
    window,
  ])

  if (routeShape == null || gradient == null) return null
  return (
    <>
      <ShapeSource id="center-ride-zoom-focus-source" shape={routeShape} lineMetrics>
        <LineLayer
          belowLayerID={HISTORY_ENDPOINT_LAYER_ID}
          id="center-ride-zoom-focus-line"
          style={{
            lineGradient: gradient,
            lineWidth: DIM_WIDTH,
            lineCap: 'round',
            lineJoin: 'round',
          }}
        />
      </ShapeSource>
      {focus ? (
        <ShapeSource id="center-ride-zoom-slice-source" shape={focus.shape} lineMetrics>
          <LineLayer
            belowLayerID={HISTORY_ENDPOINT_LAYER_ID}
            id="center-ride-zoom-slice-casing"
            style={{
              lineColor: theme.alpha(theme.palette.slate.surfaceDeep, 0.85),
              lineWidth: highContrastRoutes ? 8 : 0,
              lineCap: 'round',
              lineJoin: 'round',
            }}
          />
          <LineLayer
            belowLayerID={HISTORY_ENDPOINT_LAYER_ID}
            id="center-ride-zoom-slice-line"
            style={{
              lineColor: getHistoryMetricBaseColor(metric, telemetryColors),
              lineWidth: highContrastRoutes ? 5 : 4,
              lineCap: 'round',
              lineJoin: 'round',
              ...(focus.gradient ? { lineGradient: focus.gradient } : {}),
            }}
          />
        </ShapeSource>
      ) : null}
    </>
  )
}

function dimOutsideGradient(
  window: ChartTimeRange,
  progress: RouteTimeProgress,
): NonNullable<LineLayerStyle['lineGradient']> {
  const from = progressAtTime(window.startMs, progress)
  const to = progressAtTime(window.endMs, progress)
  const stops: (number | string)[] = [0, DIM_COLOR]

  if (from > 0) stops.push(Math.max(0, from - FADE), DIM_COLOR)
  stops.push(from, CLEAR_COLOR, to, CLEAR_COLOR)
  if (to < 1) stops.push(Math.min(1, to + FADE), DIM_COLOR)
  stops.push(1, DIM_COLOR)

  const strict: (number | string)[] = []
  for (let i = 0; i < stops.length; i += 2) {
    const at = stops[i] as number
    const previous = strict.length > 0 ? (strict[strict.length - 2] as number) : -1
    strict.push(at <= previous ? previous + STOP_EPSILON : at, stops[i + 1])
  }

  return ['interpolate', ['linear'], ['line-progress'], ...strict] as unknown as NonNullable<
    LineLayerStyle['lineGradient']
  >
}
