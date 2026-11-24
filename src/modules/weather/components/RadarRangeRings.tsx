import { LineLayer, ShapeSource, SymbolLayer } from '@rnmapbox/maps'
import { useMemo } from 'react'

import { theme } from '@/constants/theme'
import { makeCircleFeature, offsetCoordinate } from '@/helpers/mapGeometry'
import { useResolvedNeutralColors } from '@/hooks/useTheme'

/**
 * @parity /watch/watchos/RadarScreen.swift `RANGE_RING_KM`
 * @parity /watch/wearos/src/main/java/app/vescape/wear/RadarScreen.kt `RANGE_RING_KM`
 */
const RANGE_RING_KM = [50, 100]

const RING_LINE_WIDTH = 1.5
const RING_DASH: [number, number] = [3, 3]

const LABEL_HEADING_DEG = 90

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

  const labels = useMemo<GeoJSON.FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: fix
        ? RANGE_RING_KM.map((km) => ({
            type: 'Feature' as const,
            geometry: {
              type: 'Point' as const,
              coordinates: offsetCoordinate(
                [fix.longitude, fix.latitude],
                LABEL_HEADING_DEG,
                km * 1_000,
              ),
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
