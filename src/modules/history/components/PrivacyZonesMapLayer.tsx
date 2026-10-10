import { FillLayer, LineLayer, ShapeSource } from '@rnmapbox/maps'
import { useEffect, useMemo } from 'react'
import { processColor } from 'react-native'

import { theme } from '@/constants/theme'
import { makeCircleFeature } from '@/helpers/mapGeometry'
import { useResolvedNeutralColors } from '@/hooks/useTheme'
import { usePrivacyZoneStore } from '@/modules/history/store/privacyZoneStore'

/** Dash pattern is in multiples of the line width, so keep the width fixed to keep the dots even. */
const ZONE_LINE_WIDTH = 1.5
const ZONE_DASH: [number, number] = [3, 3]

export function PrivacyZonesMapLayer() {
  const neutral = useResolvedNeutralColors()
  const zones = usePrivacyZoneStore((s) => s.zones)
  const loaded = usePrivacyZoneStore((s) => s.loaded)
  const load = usePrivacyZoneStore((s) => s.load)

  useEffect(() => {
    if (!loaded) void load()
  }, [loaded, load])

  const shape = useMemo<GeoJSON.FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: zones
        .filter((zone) => zone.enabled)
        .map((zone) =>
          makeCircleFeature(zone.centerLongitude, zone.centerLatitude, zone.radiusMeters),
        ),
    }),
    [zones],
  )

  if (shape.features.length === 0) return null

  return (
    <ShapeSource id="privacy-zones" shape={shape}>
      <FillLayer
        id="privacy-zone-fill"
        style={{
          fillColor: processColor(theme.palette.mono.black) as never,
          fillOpacity: 0.12,
        }}
      />
      <LineLayer
        id="privacy-zone-outline"
        style={{
          lineColor: theme.alpha(neutral.textSecondary, 0.7),
          lineWidth: ZONE_LINE_WIDTH,
          lineDasharray: ZONE_DASH,
        }}
      />
    </ShapeSource>
  )
}
