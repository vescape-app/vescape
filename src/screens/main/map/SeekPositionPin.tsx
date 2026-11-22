import { CircleLayer, ShapeSource } from '@rnmapbox/maps'
import { useCallback, useMemo, useRef } from 'react'
import { useAnimatedReaction } from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'

import { useResolvedAccentColors, useResolvedNeutralColors } from '@/hooks/useTheme'
import { scrubHeadMs } from '@/modules/history/lib/chartFocus'
import type { HistoryGpsSample } from '@/modules/history/store/historyStore'

const EMPTY_SEEK_SHAPE: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }
const SEEK_PIN_RADIUS = 7
const SEEK_SOURCE_ID = 'center-seek-position-source'

export function SeekPositionPin({ rideGpsSamples }: { rideGpsSamples: HistoryGpsSample[] }) {
  const accents = useResolvedAccentColors()
  const neutral = useResolvedNeutralColors()
  const sourceRef = useRef<ShapeSource>(null)

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
    sourceRef.current?.setNativeProps({ id: SEEK_SOURCE_ID, shape: JSON.stringify(shape) })
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
    <ShapeSource id={SEEK_SOURCE_ID} ref={sourceRef} shape={EMPTY_SEEK_SHAPE}>
      <CircleLayer
        id="center-seek-position-circle"
        style={{
          circleRadius: SEEK_PIN_RADIUS,
          circleColor: accents.violet.color,
          circleStrokeWidth: 2,
          circleStrokeColor: neutral.bg,
        }}
      />
    </ShapeSource>
  )
}
