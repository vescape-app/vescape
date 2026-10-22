import { LineLayer, ShapeSource } from '@rnmapbox/maps'
import { theme } from '@/constants/theme'

/** Thin white diagnostic trace, drawn over measured history and below the position marker. */
export function GpsDisplayTrailLayer({
  shape,
}: {
  shape: GeoJSON.Feature<GeoJSON.MultiLineString> | null
}) {
  if (!shape) return null
  return (
    <ShapeSource id="center-display-trail-source" shape={shape}>
      <LineLayer
        id="center-display-trail-line"
        style={{
          lineColor: theme.palette.mono.white,
          lineWidth: 2,
          lineOpacity: 0.95,
          lineCap: 'round',
          lineJoin: 'round',
        }}
      />
    </ShapeSource>
  )
}
