import { CircleLayer, ShapeSource } from '@rnmapbox/maps'
import { useCallback, useMemo, useRef } from 'react'
import { runOnJS, useAnimatedReaction } from 'react-native-reanimated'

import { theme } from '@/constants/theme'
import { scrubHeadMs } from '@/modules/history/lib/scrubHead'
import { MAP_DEFAULTS } from '@/modules/map/constants/mapStyles'
import type { HistoryGpsSample } from '@/modules/history/store/historyStore'

const EMPTY_SEEK_SHAPE: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }
const SEEK_PIN_RADIUS = 7
const SEEK_SOURCE_ID = 'center-seek-position-source'

/**
 * The marker following the finger on the telemetry chart.
 *
 * A GL circle updated imperatively, not an annotation and not React state. Every step of a scrub
 * moved this marker, and a `PointAnnotation` carrying child views re-snapshots those views to a
 * bitmap on every coordinate change — enough work per touch sample to stall the whole app. A
 * circle layer takes a new position as one tiny GeoJSON, so the drag needs no render at all and
 * no throttling: the ride's track is read on the UI thread, and only the result crosses over.
 */
export function SeekPositionPin({ rideGpsSamples }: { rideGpsSamples: HistoryGpsSample[] }) {
  const sourceRef = useRef<ShapeSource>(null)

  // Parallel arrays so the lookup can run in a worklet; the samples themselves cannot cross.
  const track = useMemo(() => {
    const ts: number[] = []
    const lon: number[] = []
    const lat: number[] = []
    for (const sample of rideGpsSamples) {
      if (sample.latitude == null || sample.longitude == null) continue
      ts.push(sample.capturedAtMs)
      lon.push(sample.longitude)
      lat.push(sample.latitude)
    }
    return { ts, lon, lat }
  }, [rideGpsSamples])

  const moveTo = useCallback((longitude: number, latitude: number, visible: boolean) => {
    const shape: GeoJSON.Feature<GeoJSON.Point> | GeoJSON.FeatureCollection = visible
      ? {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [longitude, latitude] },
          properties: {},
        }
      : EMPTY_SEEK_SHAPE
    // `id` is required by the native prop type but never changes; the shape is the update.
    sourceRef.current?.setNativeProps({ id: SEEK_SOURCE_ID, shape: JSON.stringify(shape) })
  }, [])

  useAnimatedReaction(
    () => scrubHeadMs.value,
    (timeMs) => {
      'worklet'
      const { ts, lon, lat } = track
      if (timeMs == null || ts.length === 0) {
        runOnJS(moveTo)(0, 0, false)
        return
      }
      // Binary search for the sample bracketing the moment, then take the nearer of the two.
      let lo = 0
      let hi = ts.length - 1
      while (lo < hi) {
        const mid = (lo + hi) >> 1
        if (ts[mid] < timeMs) lo = mid + 1
        else hi = mid
      }
      const index = lo > 0 && timeMs - ts[lo - 1] < ts[lo] - timeMs ? lo - 1 : lo
      runOnJS(moveTo)(lon[index], lat[index], true)
    },
    [moveTo, track],
  )

  return (
    <ShapeSource id={SEEK_SOURCE_ID} ref={sourceRef} shape={EMPTY_SEEK_SHAPE}>
      <CircleLayer
        id="center-seek-position-circle"
        style={{
          circleRadius: SEEK_PIN_RADIUS,
          circleColor: MAP_DEFAULTS.markerColor,
          circleStrokeWidth: 2,
          circleStrokeColor: theme.palette.slate.bg,
        }}
      />
    </ShapeSource>
  )
}
