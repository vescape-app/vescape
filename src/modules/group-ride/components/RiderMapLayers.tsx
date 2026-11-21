import { LineLayer, ShapeSource } from '@rnmapbox/maps'
import { useMemo } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import type { GroupRidePin } from 'vescape-core'

import { Text } from '@/components/base/Text'
import { InMapMarker } from '@/components/map/InMapMarker'
import { PinKindBadge } from '@/modules/group-ride/components/PinKindBadge'
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

export function RiderPresencePin({ rider, onPress }: { rider: RosterRider; onPress?: () => void }) {
  const accents = useResolvedAccentColors()
  const color = riderMapColor(rider, accents)
  const heading = rider.presence?.heading ?? null
  if (!rider.presence) return null

  return (
    <InMapMarker coordinate={[rider.presence.lng, rider.presence.lat]}>
      <Pressable
        style={styles.riderMarker}
        onPress={onPress}
        disabled={!onPress}
        accessibilityRole={onPress ? 'button' : undefined}
        accessibilityLabel={onPress ? `Open ${rider.name || 'rider'}` : undefined}
      >
        <View style={[styles.riderDot, { backgroundColor: color }]}>
          {heading != null && (
            <View style={[styles.riderHeadingRing, { transform: [{ rotate: `${heading}deg` }] }]}>
              <View style={[styles.riderHeadingArrow, { borderBottomColor: color }]} />
            </View>
          )}
        </View>
        <Text style={[styles.riderLabel, rider.stale && styles.riderLabelStale]} numberOfLines={1}>
          {rider.name || 'Rider'}
        </Text>
      </Pressable>
    </InMapMarker>
  )
}

export function LiveRiderSignalPins() {
  const rosterRows = useGroupRideStore((s) => s.rosterRows)
  const clock = useGroupRideStore((s) => s.relayClock)
  const publicOwn = useGroupRideStore((s) => s.publicOwnPins)
  const rows = useMemo(
    () =>
      publicOwn && (publicOwn.signal || publicOwn.hazard)
        ? [...rosterRows, ownPinsRow(publicOwn)]
        : rosterRows,
    [rosterRows, publicOwn],
  )
  return <RiderSignalPins rows={rows} clock={clock} />
}

function ownPinsRow(pins: {
  signal: GroupRidePin | null
  hazard: GroupRidePin | null
}): RosterRider {
  return {
    id: 'self',
    name: 'You',
    presence: null,
    stale: false,
    away: false,
    lastSeen: 0,
    signal: pins.signal,
    hazard: pins.hazard,
    isSelf: true,
  }
}

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
      />
    ) : null,
  ])
}

function RiderPinMarker({
  rider,
  pin: rawPin,
  clock,
  info,
}: {
  rider: RosterRider
  pin: GroupRidePin
  clock: RelayClock | null
  info: PinKindInfo | null
}) {
  const accents = useResolvedAccentColors()
  const neutral = useResolvedNeutralColors()
  const pin = useActivePin(rawPin, clock)
  if (!pin || !info) return null
  const color = accents[info.hue].color

  return (
    <InMapMarker coordinate={[pin.lng, pin.lat]}>
      <View
        style={styles.signalMarker}
        accessibilityLabel={`${rider.name || 'Rider'}: ${info.label}`}
      >
        <PinKindBadge
          info={info}
          color={color}
          size={SIGNAL_PIN_SIZE}
          strokeWidth={2}
          fill={theme.alpha(neutral.surfaceDeep, 0.85)}
          weight="bold"
        />
        <View style={[styles.signalStem, { backgroundColor: color }]} />
        <View
          style={[styles.signalFoot, { backgroundColor: color, borderColor: neutral.surfaceDeep }]}
        />
      </View>
    </InMapMarker>
  )
}

const SIGNAL_PIN_SIZE = 40
const SIGNAL_STEM_HEIGHT = 22
const SIGNAL_FOOT_SIZE = 8
const RIDER_LABEL_GAP = 4
const RIDER_LABEL_HEIGHT = 20

const styles = StyleSheet.create({
  signalMarker: {
    alignItems: 'center',
    paddingBottom: SIGNAL_PIN_SIZE + SIGNAL_STEM_HEIGHT,
  },
  signalFoot: {
    width: SIGNAL_FOOT_SIZE,
    height: SIGNAL_FOOT_SIZE,
    borderRadius: SIGNAL_FOOT_SIZE / 2,
    borderWidth: 1.5,
  },
  signalStem: {
    width: 2,
    height: SIGNAL_STEM_HEIGHT,
    borderRadius: 1,
  },
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
