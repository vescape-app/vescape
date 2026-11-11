import { GeoJSONSource, Layer, type GeoJSONSourceRef } from '@maplibre/maplibre-react-native'
import { useCallback, useMemo, useRef } from 'react'
import { useAnimatedReaction } from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'

import { useResolvedAccentColors, useResolvedNeutralColors } from '@/hooks/useTheme'
import { scrubHeadMs } from '@/modules/history/lib/chartFocus'
import type { HistoryGpsSample } from '@/modules/history/store/historyStore'

const EMPTY_SEEK_SHAPE: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }
const SEEK_PIN_RADIUS = 7
const SEEK_SOURCE_ID = 'center-seek-position-source'
export const SEEK_POSITION_LAYER_ID = 'center-seek-position-circle'

/**
 * The marker following the finger on the telemetry chart.
 *
 * A GL circle updated imperatively, not a marker view and not React state: every step of a scrub
 * moves it, and a React render per touch sample is enough work to stall the whole app. A
 * circle layer takes a new position as one tiny GeoJSON, so the drag needs no render at all and
 * no throttling: the ride's track is read on the UI thread, and only the result crosses over.
 */
export function SeekPositionPin({ rideGpsSamples }: { rideGpsSamples: HistoryGpsSample[] }) {
  const accents = useResolvedAccentColors()
  const neutral = useResolvedNeutralColors()
  const sourceRef = useRef<GeoJSONSourceRef>(null)

  // Parallel arrays so the lookup can run in a worklet; the samples themselves cannot cross.
  const track = useMemo(() => {
    const ts: number[] = []
    const lon: number[] = []
    const lat: number[] = []
    for (const sample of rideGpsSamples) {
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
    // The native `data` prop is the update; nothing on the React side re-renders.
    sourceRef.current?.getAnimatableRef()?.setNativeProps({ data: JSON.stringify(shape) })
  }, [])

  useAnimatedReaction(
    () => scrubHeadMs.value,
    (timeMs) => {
      'worklet'
      const { ts, lon, lat } = track
      if (timeMs == null || ts.length === 0) {
        scheduleOnRN(moveTo, 0, 0, false)
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
      scheduleOnRN(moveTo, lon[index], lat[index], true)
    },
    [moveTo, track],
  )

  return (
    <GeoJSONSource id={SEEK_SOURCE_ID} ref={sourceRef} data={EMPTY_SEEK_SHAPE}>
      <Layer
        type="circle"
        id={SEEK_POSITION_LAYER_ID}
        paint={{
          'circle-radius': SEEK_PIN_RADIUS,
          'circle-color': accents.violet.color,
          'circle-stroke-width': 2,
          'circle-stroke-color': neutral.bg,
        }}
      />
    </GeoJSONSource>
  )
}
