import { useEffect, useState } from 'react'
import { CircleLayer, LineLayer, ShapeSource } from '@rnmapbox/maps'
import { theme } from '@/constants/theme'
import { useResolvedAccentColors } from '@/hooks/useTheme'
import type { MotionDisplay } from '@/modules/map/lib/liveMotion/display'
import { useLiveMotionSettings } from '@/modules/map/store/liveMotionSettings'
import { useScreenVisible } from '@/hooks/useScreenVisible'

/** Geometry changes only on native debug batches; no renderer frame loop. */
export function MotionComparisonLayers({ motion }: { motion: MotionDisplay }) {
  const visible = useScreenVisible()
  const showRaw = useLiveMotionSettings((state) => state.showRawGpsPoint)
  const showTrail = useLiveMotionSettings((state) => state.showSmoothedTrail)
  const [overlays, setOverlays] = useState(() => motion.overlays())
  const accents = useResolvedAccentColors()
  useEffect(() => {
    if (!visible || (!showRaw && !showTrail)) return
    const update = () => {
      const snapshot = motion.overlays()
      const next = { raw: showRaw ? snapshot.raw : null, trail: showTrail ? snapshot.trail : [] }
      setOverlays((previous) =>
        JSON.stringify(previous) === JSON.stringify(next) ? previous : next,
      )
    }
    update()
    return motion.subscribe(update)
  }, [motion, visible, showRaw, showTrail])
  if (!visible) return null
  const raw = overlays.raw
  return (
    <>
      {showTrail && overlays.trail.length > 1 && (
        <ShapeSource
          id="display-debug-trail"
          shape={{
            type: 'Feature',
            properties: {},
            geometry: { type: 'LineString', coordinates: overlays.trail },
          }}
        >
          <LineLayer
            id="display-debug-trail-casing"
            style={{
              lineColor: theme.palette.mono.black,
              lineWidth: 6,
              lineCap: 'round',
              lineJoin: 'round',
            }}
          />
          <LineLayer
            id="display-debug-trail-white"
            style={{
              lineColor: theme.palette.mono.white,
              lineWidth: 3,
              lineCap: 'round',
              lineJoin: 'round',
            }}
          />
        </ShapeSource>
      )}
      {showRaw && raw && (
        <ShapeSource
          id="display-debug-raw"
          shape={{
            type: 'Feature',
            properties: {},
            geometry: { type: 'Point', coordinates: raw.coordinate },
          }}
        >
          <CircleLayer
            id="display-debug-raw-ring"
            style={{
              circleRadius: 9,
              circleColor: 'transparent',
              circleStrokeWidth: 3,
              circleStrokeColor:
                raw.accepted && raw.accuracyM != null ? accents.sky.color : accents.amber.color,
              circleOpacity: raw.stale ? 0.35 : 1,
              circleStrokeOpacity: raw.stale ? 0.35 : 1,
            }}
          />
        </ShapeSource>
      )}
    </>
  )
}
