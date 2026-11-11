import { GeoJSONSource, Layer } from '@maplibre/maplibre-react-native'
import { useEffect, useMemo } from 'react'

import { theme } from '@/constants/theme'
import { makeCircleFeature } from '@/helpers/mapGeometry'
import { useResolvedNeutralColors } from '@/hooks/useTheme'
import { usePrivacyZoneStore } from '@/modules/history/store/privacyZoneStore'

/** Dash pattern is in multiples of the line width, so keep the width fixed to keep the dots even. */
const ZONE_LINE_WIDTH = 1.5
const ZONE_DASH: [number, number] = [3, 3]

/** `fillBeforeId`: first label layer of the loaded style, so the fill stays under labels. */
export function PrivacyZonesMapLayer({ fillBeforeId }: { fillBeforeId?: string }) {
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
    <GeoJSONSource id="privacy-zones" data={shape}>
      <Layer
        type="fill"
        id="privacy-zone-fill"
        beforeId={fillBeforeId}
        paint={{ 'fill-color': theme.palette.mono.black, 'fill-opacity': 0.12 }}
      />
      <Layer
        type="line"
        id="privacy-zone-outline"
        paint={{
          'line-color': theme.alpha(neutral.textSecondary, 0.7),
          'line-width': ZONE_LINE_WIDTH,
          'line-dasharray': ZONE_DASH,
        }}
      />
    </GeoJSONSource>
  )
}
