import { LineLayer, ShapeSource, SymbolLayer } from '@rnmapbox/maps'
import { useMemo } from 'react'

import { theme } from '@/constants/theme'
import { makeCircleFeature } from '@/helpers/mapGeometry'
import { useResolvedNeutralColors } from '@/hooks/useTheme'

/**
 * Distance rings around the rider while the radar is up, so a band of rain reads as "how far" and
 * not just "somewhere north". Mirrors the wrist radar page, down to the dashed stroke and the two
 * distances; the phone can pan away from the rider, so the rings are anchored to the fix rather
 * than to the screen centre.
 *
 * @parity /watch/wearos/src/main/java/app/vescape/wear/RadarScreen.kt `RANGE_RING_KM`
 */
const RANGE_RING_KM = [50, 100]

/**
 * Heavier than the privacy-zone rings: those sit on a plain basemap, these sit over radar imagery
 * and map detail at once, and a hairline disappears into both.
 *
 * Dash pattern is in multiples of the line width, so a fixed width keeps the dashes even.
 */
const RING_LINE_WIDTH = 1.5
const RING_DASH: [number, number] = [3, 3]
const EARTH_RADIUS_M = 6_378_137

interface RadarRangeRingsProps {
  visible: boolean
  fix: { longitude: number; latitude: number } | null
}

export function RadarRangeRings({ visible, fix }: RadarRangeRingsProps) {
  const neutral = useResolvedNeutralColors()

  const rings = useMemo<GeoJSON.FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: fix
        ? RANGE_RING_KM.map((km) => makeCircleFeature(fix.longitude, fix.latitude, km * 1_000))
        : [],
    }),
    [fix],
  )

  // Labels sit due east of the rider, on the ring itself: the one radius the timeline, the pill and
  // the hourly strip all leave empty. They are drawn *inside* the ring — the outer ring is framed
  // against the screen edge, so an outward label is half off the screen.
  const labels = useMemo<GeoJSON.FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: fix
        ? RANGE_RING_KM.map((km) => ({
            type: 'Feature' as const,
            geometry: {
              type: 'Point' as const,
              coordinates: [fix.longitude + eastOffsetDeg(fix.latitude, km * 1_000), fix.latitude],
            },
            properties: { label: `${km} km` },
          }))
        : [],
    }),
    [fix],
  )

  if (!visible || !fix) return null

  return (
    <>
      <ShapeSource id="radar-range-rings" shape={rings}>
        <LineLayer
          id="radar-range-ring-line"
          style={{
            lineColor: theme.alpha(neutral.textSecondary, 0.6),
            lineWidth: RING_LINE_WIDTH,
            lineDasharray: RING_DASH,
          }}
        />
      </ShapeSource>
      <ShapeSource id="radar-range-ring-labels" shape={labels}>
        <SymbolLayer
          id="radar-range-ring-label"
          style={{
            textField: ['get', 'label'],
            textSize: 12,
            textColor: neutral.textPrimary,
            textHaloColor: neutral.surfaceDeep,
            textHaloWidth: 1.6,
            textAnchor: 'right',
            textOffset: [-0.4, 0],
          }}
        />
      </ShapeSource>
    </>
  )
}

/** Degrees of longitude that cover [distanceM] due east at [latitude]. */
function eastOffsetDeg(latitude: number, distanceM: number): number {
  const latRad = (latitude * Math.PI) / 180
  return ((distanceM / (EARTH_RADIUS_M * Math.cos(latRad))) * 180) / Math.PI
}
