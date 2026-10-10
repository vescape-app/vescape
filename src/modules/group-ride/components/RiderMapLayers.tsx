import { LineLayer, MarkerView, ShapeSource } from '@rnmapbox/maps'
import { useMemo } from 'react'
import { StyleSheet, View } from 'react-native'

import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'
import { useResolvedAccentColors, useResolvedNeutralColors } from '@/hooks/useTheme'
import { makeTrailLineString } from '@/helpers/mapGeometry'
import { rosterRiderColor } from '@/modules/group-ride/lib/riderColor'
import type { RosterRider } from '@/modules/group-ride/lib/roster'
import { MAP_DEFAULTS } from '@/modules/map/constants/mapStyles'

// A peer's recent path, tinted like their marker and fading out toward the tail —
// the group-ride counterpart to the device's own live trail.
export function RiderTrail({
  rider,
  index,
  highContrastRoutes,
}: {
  rider: RosterRider
  index: number
  highContrastRoutes: boolean
}) {
  const neutral = useResolvedNeutralColors()
  const accents = useResolvedAccentColors()
  const color = rosterRiderColor(rider, index, accents)
  const shape = useMemo(
    () =>
      rider.trail && rider.trail.length >= 2
        ? makeTrailLineString(rider.trail.map((p) => ({ longitude: p.lng, latitude: p.lat })))
        : null,
    [rider.trail],
  )
  if (!shape) return null

  return (
    <ShapeSource id={`center-rider-trail-source-${rider.id}`} shape={shape} lineMetrics>
      <LineLayer
        id={`center-rider-trail-casing-${rider.id}`}
        style={{
          lineColor: theme.alpha(neutral.surfaceDeep, 0.85),
          lineWidth: highContrastRoutes ? MAP_DEFAULTS.trailWidth + 4 : 0,
          lineCap: 'round',
          lineJoin: 'round',
        }}
      />
      <LineLayer
        id={`center-rider-trail-line-${rider.id}`}
        style={{
          lineColor: color,
          lineWidth: MAP_DEFAULTS.trailWidth,
          lineCap: 'round',
          lineJoin: 'round',
          lineGradient: [
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
    </ShapeSource>
  )
}

export function RiderPresencePin({ rider, index }: { rider: RosterRider; index: number }) {
  const accents = useResolvedAccentColors()
  const color = rosterRiderColor(rider, index, accents)
  const heading = rider.presence?.heading ?? null
  if (!rider.presence) return null

  return (
    <MarkerView coordinate={[rider.presence.lng, rider.presence.lat]} allowOverlap>
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
    </MarkerView>
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
