import { GeoJSONSource, Layer, Marker } from '@maplibre/maplibre-react-native'
import { useMemo } from 'react'
import { StyleSheet, View } from 'react-native'

import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'
import { useResolvedAccentColors, useResolvedNeutralColors } from '@/hooks/useTheme'
import { makeTrailLineString } from '@/helpers/mapGeometry'
import { riderMapColor } from '@/modules/group-ride/lib/riderColor'
import type { RosterRider } from '@/modules/group-ride/lib/roster'
import { MAP_DEFAULTS } from '@/modules/map/constants/mapStyles'

// A peer's recent path, tinted like their marker and fading out toward the tail —
// the group-ride counterpart to the device's own live trail.
export function RiderTrail({
  rider,
  highContrastRoutes,
}: {
  rider: RosterRider
  highContrastRoutes: boolean
}) {
  const neutral = useResolvedNeutralColors()
  const accents = useResolvedAccentColors()
  const color = riderMapColor(rider, accents)
  const shape = useMemo(
    () =>
      rider.trail && rider.trail.length >= 2
        ? makeTrailLineString(rider.trail.map((p) => ({ longitude: p.lng, latitude: p.lat })))
        : null,
    [rider.trail],
  )
  if (!shape) return null

  return (
    <GeoJSONSource id={`center-rider-trail-source-${rider.id}`} data={shape} lineMetrics>
      <Layer
        type="line"
        id={`center-rider-trail-casing-${rider.id}`}
        layout={{ 'line-cap': 'round', 'line-join': 'round' }}
        paint={{
          'line-color': theme.alpha(neutral.surfaceDeep, 0.85),
          'line-width': highContrastRoutes ? MAP_DEFAULTS.trailWidth + 4 : 0,
        }}
      />
      <Layer
        type="line"
        id={`center-rider-trail-line-${rider.id}`}
        layout={{ 'line-cap': 'round', 'line-join': 'round' }}
        paint={{
          'line-color': color,
          'line-width': MAP_DEFAULTS.trailWidth,
          'line-gradient': [
            'interpolate',
            ['linear'],
            ['line-progress'],
            0,
            theme.alpha(color, 0),
            1,
            theme.alpha(color, 0.85),
          ],
        }}
      />
    </GeoJSONSource>
  )
}

export function RiderPresencePin({ rider }: { rider: RosterRider }) {
  const accents = useResolvedAccentColors()
  const color = riderMapColor(rider, accents)
  const heading = rider.presence?.heading ?? null
  if (!rider.presence) return null

  return (
    <Marker lngLat={[rider.presence.lng, rider.presence.lat]}>
      <View style={styles.riderMarker}>
        <View style={[styles.riderDot, { backgroundColor: color }]}>
          {heading != null && (
            // Rotating a ring centered on the dot keeps the arrow orbiting the dot;
            // rotating the arrow itself would spin it in place at a fixed offset.
            <View style={[styles.riderHeadingRing, { transform: [{ rotate: `${heading}deg` }] }]}>
              <View style={[styles.riderHeadingArrow, { borderBottomColor: color }]} />
            </View>
          )}
        </View>
        <Text style={[styles.riderLabel, rider.stale && styles.riderLabelStale]} numberOfLines={1}>
          {rider.name || 'Rider'}
        </Text>
      </View>
    </Marker>
  )
}

const styles = StyleSheet.create({
  riderMarker: {
    alignItems: 'center',
    gap: 4,
  },
  riderDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
  },
  riderHeadingRing: {
    position: 'absolute',
    top: -8,
    left: -8,
    width: 32,
    height: 32,
    alignItems: 'center',
  },
  riderHeadingArrow: {
    width: 0,
    height: 0,
    borderLeftWidth: 4,
    borderRightWidth: 4,
    borderBottomWidth: 7,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
  riderLabel: {
    maxWidth: 96,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    overflow: 'hidden',
    backgroundColor: theme.alpha(theme.neutral.surfaceDeep, 0.85),
    color: theme.neutral.textPrimary,
    fontSize: 11,
    fontWeight: '800',
  },
  riderLabelStale: {
    color: theme.neutral.textMuted,
  },
})
