import { LineLayer, MarkerView, ShapeSource } from '@rnmapbox/maps'
import { useMemo } from 'react'
import { StyleSheet, View } from 'react-native'

import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'
import { useResolvedAccentColors, useResolvedNeutralColors } from '@/hooks/useTheme'
import { makeTrailLineString } from '@/helpers/mapGeometry'
import { riderMapColor } from '@/modules/group-ride/lib/riderColor'
import type { RosterRider } from '@/modules/group-ride/lib/roster'
import { MAP_DEFAULTS } from '@/modules/map/constants/mapStyles'
import { riderSignalKindInfo } from '@/modules/group-ride/constants/riderSignalKinds'
import { useActiveRiderSignal } from '@/modules/group-ride/hooks/useActiveRiderSignal'
import { useGroupRideStore } from '@/modules/group-ride/store/groupRideStore'

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

export function RiderPresencePin({ rider }: { rider: RosterRider }) {
  const accents = useResolvedAccentColors()
  const color = riderMapColor(rider, accents)
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

/** Every Rider's active signal, your own included (the presence layers leave you out). */
export function RiderSignalPins() {
  const rows = useGroupRideStore((s) => s.rosterRows)
  return rows.map((rider) =>
    rider.signal ? <RiderSignalPin key={`signal-${rider.id}`} rider={rider} /> : null,
  )
}

/**
 * A Rider's active signal, pinned where it was sent. Apart from the presence pin, so it stays put
 * while the sender moves on or goes away. Always in the sender's own color: a live call for help
 * is never muted by a stale presence. The pin stands on a stem above its spot, clear of a presence
 * dot and name label that sit on the same spot while the sender has not moved.
 */
function RiderSignalPin({ rider }: { rider: RosterRider }) {
  const accents = useResolvedAccentColors()
  const neutral = useResolvedNeutralColors()
  const signal = useActiveRiderSignal(rider.signal)
  const info = signal ? riderSignalKindInfo(signal.kind) : null
  if (!signal || !info) return null
  const color = riderMapColor({ id: rider.id, stale: false }, accents)
  const KindIcon = info.icon

  return (
    <MarkerView coordinate={[signal.lng, signal.lat]} anchor={SIGNAL_PIN_ANCHOR} allowOverlap>
      <View
        style={styles.signalMarker}
        accessibilityLabel={`${rider.name || 'Rider'}: ${info.label}`}
      >
        <View
          style={[
            styles.signalPin,
            { borderColor: color, backgroundColor: theme.alpha(neutral.surfaceDeep, 0.85) },
          ]}
        >
          <KindIcon size={18} color={color} weight="fill" />
        </View>
        <View style={[styles.signalStem, { backgroundColor: color }]} />
      </View>
    </MarkerView>
  )
}

// The presence marker centers its dot and label on the Rider's position, its heading ring reaching
// ~28 px above it. The stem lifts the signal pin past that, its foot on the signal's own spot.
const SIGNAL_PIN_SIZE = 32
const SIGNAL_STEM_HEIGHT = 30
const SIGNAL_PIN_ANCHOR = { x: 0.5, y: 1 }

const styles = StyleSheet.create({
  signalMarker: {
    alignItems: 'center',
  },
  signalStem: {
    width: 2,
    height: SIGNAL_STEM_HEIGHT,
    borderRadius: 1,
  },
  signalPin: {
    width: SIGNAL_PIN_SIZE,
    height: SIGNAL_PIN_SIZE,
    borderRadius: SIGNAL_PIN_SIZE / 2,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
