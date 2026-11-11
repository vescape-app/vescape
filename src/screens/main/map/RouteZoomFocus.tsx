import { GeoJSONSource, Layer } from '@maplibre/maplibre-react-native'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAnimatedReaction } from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'

import type { ChartTimeRange } from '@/components/charts/line/types'
import { theme } from '@/constants/theme'
import { zoomWindowMs } from '@/modules/history/lib/chartFocus'
import {
  getHistoryMetricBaseColor,
  getHistoryRouteMetricGradient,
  type LineGradient,
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

/** The scrub glow; the zoom focus goes under it. */
export const HISTORY_ROUTE_HIGHLIGHT_LAYER_ID = 'center-ride-route-highlight'
const ROUND_LINE = { 'line-cap': 'round', 'line-join': 'round' } as const

const DIM_COLOR = theme.alpha(theme.palette.slate.bg, 0.75)
const CLEAR_COLOR = theme.alpha(theme.palette.slate.bg, 0)
/** Distance over which the dim fades in, as a fraction of the route. Keeps the edge from banding. */
const FADE = 0.004
/**
 * How often the dim follows a pinch. A gradient is a style expression that has to be rebuilt and
 * re-uploaded, so it samples the zoom instead of tracking it frame by frame — the chart itself is
 * what the eye is on while zooming, and the map only has to agree by the time the fingers stop.
 */
const REFRESH_MS = 80
/** Wide enough to cover the route line and its high-contrast casing in one pass. */
const DIM_WIDTH = 6
/** Smallest gap MapLibre will accept between two stops. */
const STOP_EPSILON = 1e-6

interface RouteZoomFocusProps {
  rideGpsSamples: HistoryGpsSample[]
  routeShape: GeoJSON.Feature<GeoJSON.LineString> | null
  /** Everything the focused stretch needs to be redrawn in the colours the route already uses. */
  rideTelemetrySamples: TelemetrySample[]
  metric: HistoryMetricKey
  hotRanges: HistoryMetricHotRanges
  gradientsEnabled: boolean
  highContrastRoutes: boolean
}

/**
 * Dims the ride outside the stretch the chart is zoomed into.
 *
 * Drawn over the route as its own source rather than as another layer of the route's: the window
 * changes as the rider pinches, and a layer here would otherwise re-render the whole map tree with
 * it. The geometry is uploaded once per ride; only this component's own gradient changes.
 */
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

  // Leading edge plus a trailing catch-up, so the dim keeps up during a pinch and always ends on
  // the window the rider actually stopped at.
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

  // The dim is one line over the whole ride, so where the route crosses itself the dimmed part is
  // painted after — and on top of — the focused part. Drawing the focused stretch again as its own
  // geometry puts it back on top, whatever the ride does with itself.
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
      // Rebuilt for the slice rather than reused: `line-progress` runs 0..1 along whatever
      // geometry the layer draws, so the ride's own gradient would compress into the window.
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
      <GeoJSONSource id="center-ride-zoom-focus-source" data={routeShape} lineMetrics>
        <Layer
          type="line"
          beforeId={HISTORY_ROUTE_HIGHLIGHT_LAYER_ID}
          id="center-ride-zoom-focus-line"
          layout={ROUND_LINE}
          paint={{ 'line-gradient': gradient, 'line-width': DIM_WIDTH }}
        />
      </GeoJSONSource>
      {focus ? (
        <GeoJSONSource id="center-ride-zoom-slice-source" data={focus.shape} lineMetrics>
          <Layer
            type="line"
            beforeId={HISTORY_ROUTE_HIGHLIGHT_LAYER_ID}
            id="center-ride-zoom-slice-casing"
            layout={ROUND_LINE}
            paint={{
              'line-color': theme.alpha(theme.palette.slate.surfaceDeep, 0.85),
              'line-width': highContrastRoutes ? 8 : 0,
            }}
          />
          <Layer
            type="line"
            beforeId={HISTORY_ROUTE_HIGHLIGHT_LAYER_ID}
            id="center-ride-zoom-slice-line"
            layout={ROUND_LINE}
            paint={{
              'line-color': getHistoryMetricBaseColor(metric, telemetryColors),
              'line-width': highContrastRoutes ? 5 : 4,
              ...(focus.gradient ? { 'line-gradient': focus.gradient } : {}),
            }}
          />
        </GeoJSONSource>
      ) : null}
    </>
  )
}

/** Opaque outside the window, transparent inside it, with a short fade at either edge. */
function dimOutsideGradient(window: ChartTimeRange, progress: RouteTimeProgress): LineGradient {
  const from = progressAtTime(window.startMs, progress)
  const to = progressAtTime(window.endMs, progress)
  const stops: (number | string)[] = [0, DIM_COLOR]

  if (from > 0) stops.push(Math.max(0, from - FADE), DIM_COLOR)
  stops.push(from, CLEAR_COLOR, to, CLEAR_COLOR)
  if (to < 1) stops.push(Math.min(1, to + FADE), DIM_COLOR)
  stops.push(1, DIM_COLOR)

  // MapLibre rejects an expression whose stops are not strictly increasing, which two edges landing
  // on the same sample would produce.
  const strict: (number | string)[] = []
  for (let i = 0; i < stops.length; i += 2) {
    const at = stops[i] as number
    const previous = strict.length > 0 ? (strict[strict.length - 2] as number) : -1
    strict.push(at <= previous ? previous + STOP_EPSILON : at, stops[i + 1])
  }

  return ['interpolate', ['linear'], ['line-progress'], ...strict] as unknown as LineGradient
}
