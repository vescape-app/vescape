import { LineLayer, ShapeSource, type LineLayerStyle } from '@rnmapbox/maps'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { runOnJS, useAnimatedReaction } from 'react-native-reanimated'

import type { ChartTimeRange } from '@/components/charts/line/types'
import { theme } from '@/constants/theme'
import { zoomWindowMs } from '@/modules/history/lib/chartFocus'
import {
  progressAtTime,
  routeTimeProgress,
  type RouteTimeProgress,
} from '@/modules/history/lib/routeProgress'
import type { HistoryGpsSample } from '@/modules/history/store/historyStore'

const DIM_COLOR = theme.alpha(theme.palette.slate.bg, 0.75)
const CLEAR_COLOR = theme.alpha(theme.palette.slate.bg, 0)
/** Distance over which the dim fades in, as a fraction of the route. Keeps the edge from banding. */
const FADE = 0.004
/**
 * How often the dim follows a pinch. A gradient is a Mapbox expression that has to be rebuilt and
 * re-uploaded, so it samples the zoom instead of tracking it frame by frame — the chart itself is
 * what the eye is on while zooming, and the map only has to agree by the time the fingers stop.
 */
const REFRESH_MS = 80
/** Wide enough to cover the route line and its high-contrast casing in one pass. */
const DIM_WIDTH = 6
/** Smallest gap Mapbox will accept between two stops. */
const STOP_EPSILON = 1e-6

interface RouteZoomFocusProps {
  rideGpsSamples: HistoryGpsSample[]
  routeShape: GeoJSON.Feature<GeoJSON.LineString> | null
}

/**
 * Dims the ride outside the stretch the chart is zoomed into.
 *
 * Drawn over the route as its own source rather than as another layer of the route's: the window
 * changes as the rider pinches, and a layer here would otherwise re-render the whole map tree with
 * it. The geometry is uploaded once per ride; only this component's own gradient changes.
 */
export function RouteZoomFocus({ rideGpsSamples, routeShape }: RouteZoomFocusProps) {
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
      runOnJS(apply)(next)
    },
    [apply],
  )

  const gradient = useMemo(
    () => (window == null ? null : dimOutsideGradient(window, progress)),
    [progress, window],
  )

  if (routeShape == null || gradient == null) return null
  return (
    <ShapeSource id="center-ride-zoom-focus-source" shape={routeShape} lineMetrics>
      <LineLayer
        id="center-ride-zoom-focus-line"
        style={{
          lineGradient: gradient,
          lineWidth: DIM_WIDTH,
          lineCap: 'round',
          lineJoin: 'round',
        }}
      />
    </ShapeSource>
  )
}

/** Opaque outside the window, transparent inside it, with a short fade at either edge. */
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

  // Mapbox rejects an expression whose stops are not strictly increasing, which two edges landing
  // on the same sample would produce.
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
