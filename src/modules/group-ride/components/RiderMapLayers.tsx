import { LineLayer, ShapeSource } from '@rnmapbox/maps'
import { useMemo } from 'react'
import { StyleSheet, View } from 'react-native'
import type { GroupRidePin } from 'vescape-core'

import { Text } from '@/components/base/Text'
import { InMapMarker } from '@/components/map/InMapMarker'
import { theme } from '@/constants/theme'
import { useResolvedAccentColors, useResolvedNeutralColors } from '@/hooks/useTheme'
import { makeTrailLineString } from '@/helpers/mapGeometry'
import { riderMapColor } from '@/modules/group-ride/lib/riderColor'
import type { RosterRider } from '@/modules/group-ride/lib/roster'
import { MAP_DEFAULTS } from '@/modules/map/constants/mapStyles'
import {
  rideHazardKindInfo,
  riderSignalKindInfo,
  type PinKindInfo,
} from '@/modules/group-ride/constants/riderSignalKinds'
import { useActivePin } from '@/modules/group-ride/hooks/useActiveRiderSignal'
import type { RelayClock } from '@/modules/group-ride/lib/riderSignal'
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
    <InMapMarker coordinate={[rider.presence.lng, rider.presence.lat]}>
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
    </InMapMarker>
  )
}

/** Every Rider's active signal, your own included (the presence layers leave you out). */
export function LiveRiderSignalPins() {
  const rows = useGroupRideStore((s) => s.rosterRows)
  const clock = useGroupRideStore((s) => s.relayClock)
  return <RiderSignalPins rows={rows} clock={clock} />
}

/** The signals and hazards in `rows` still active on `clock`. */
export function RiderSignalPins({
  rows,
  clock,
}: {
  rows: RosterRider[]
  clock: RelayClock | null
}) {
  return rows.flatMap((rider) => [
    rider.signal ? (
      <RiderPinMarker
        key={`signal-${rider.id}`}
        rider={rider}
        pin={rider.signal}
        clock={clock}
        info={riderSignalKindInfo(rider.signal.kind)}
      />
    ) : null,
    rider.hazard ? (
      <RiderPinMarker
        key={`hazard-${rider.id}`}
        rider={rider}
        pin={rider.hazard}
        clock={clock}
        info={rideHazardKindInfo(rider.hazard.kind)}
        place
      />
    ) : null,
  ])
}

/**
 * A Rider's active signal or hazard, pinned where it was sent. Apart from the presence pin, so it
 * stays put while the sender moves on or goes away. In its kind's hue, like its Ride Notice, roster
 * badge, and picker tile, and never muted by a stale presence. The pin stands on a stem above its
 * spot, clear of a presence dot and name label that sit on the same spot while the sender has not
 * moved. A hazard (`place`) is a rounded square: it marks the trail, not the Rider.
 */
function RiderPinMarker({
  rider,
  pin: rawPin,
  clock,
  info,
  place = false,
}: {
  rider: RosterRider
  pin: GroupRidePin
  clock: RelayClock | null
  info: PinKindInfo | null
  place?: boolean
}) {
  const accents = useResolvedAccentColors()
  const neutral = useResolvedNeutralColors()
  const pin = useActivePin(rawPin, clock)
  if (!pin || !info) return null
  const color = accents[info.hue].color
  const KindIcon = info.icon

  return (
    <InMapMarker coordinate={[pin.lng, pin.lat]}>
      <View
        style={styles.signalMarker}
        accessibilityLabel={`${rider.name || 'Rider'}: ${info.label}`}
      >
        <View
          style={[
            styles.signalPin,
            place && styles.hazardPin,
            { borderColor: color, backgroundColor: theme.alpha(neutral.surfaceDeep, 0.85) },
          ]}
        >
          <KindIcon size={18} color={color} weight="bold" />
        </View>
        <View style={[styles.signalStem, { backgroundColor: color }]} />
      </View>
    </InMapMarker>
  )
}

// The presence marker centers its dot on the Rider's position, its heading ring reaching ~28 px
// above it. The stem lifts the signal pin past that, its foot on the signal's own spot. A marker is
// anchored at its centre, so bottom padding mirrors pin and stem to put that centre at the foot.
const SIGNAL_PIN_SIZE = 32
const SIGNAL_STEM_HEIGHT = 30
const RIDER_LABEL_GAP = 4
const RIDER_LABEL_HEIGHT = 20

const styles = StyleSheet.create({
  signalMarker: {
    alignItems: 'center',
    paddingBottom: SIGNAL_PIN_SIZE + SIGNAL_STEM_HEIGHT,
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
  hazardPin: {
    borderRadius: 8,
  },
  // A marker is anchored at its centre. The top padding mirrors the label below the dot, so that
  // centre is the dot and the rider's coordinate is not somewhere between dot and label.
  riderMarker: {
    alignItems: 'center',
    gap: RIDER_LABEL_GAP,
    paddingTop: RIDER_LABEL_HEIGHT + RIDER_LABEL_GAP,
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
    height: RIDER_LABEL_HEIGHT,
    lineHeight: RIDER_LABEL_HEIGHT,
    paddingHorizontal: 7,
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
