import { useEffect, useState, type ReactNode } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { CheckIcon, XIcon } from 'phosphor-react-native'
import {
  RIDE_HAZARD_KINDS,
  type GroupRidePin,
  type RideHazardKind,
  type RiderSignalKind,
} from 'vescape-core'

import { Banner } from '@/components/base/Banner'
import { Button } from '@/components/base/Button'
import type { IconButtonTakeover } from '@/components/base/IconButton'
import { Text } from '@/components/base/Text'
import { interaction, theme } from '@/constants/theme'
import {
  RIDE_HAZARD_KIND_INFO,
  RIDER_SIGNAL_KIND_INFO,
  rideHazardKindInfo,
  riderSignalKindInfo,
  type PinKindInfo,
} from '@/modules/group-ride/constants/riderSignalKinds'
import { useActiveRiderSignal } from '@/modules/group-ride/hooks/useActiveRiderSignal'
import {
  signalTimeLeftMs,
  topRiderSignal,
  type RelayClock,
} from '@/modules/group-ride/lib/riderSignal'
import { PinKindBadge } from '@/modules/group-ride/components/PinKindBadge'
import { useGroupRideStore } from '@/modules/group-ride/store/groupRideStore'

/** The device's own Rider Signal while it is active on the relay clock, else null. */
export function useOwnRiderSignal(): GroupRidePin | null {
  const signal = useGroupRideStore((s) => s.rosterRows.find((row) => row.isSelf)?.signal ?? null)
  return useActiveRiderSignal(signal)
}

/** The device's own Ride Hazard while it is active on the relay clock, else null. */
function useOwnRideHazard(): GroupRidePin | null {
  const hazard = useGroupRideStore((s) => s.rosterRows.find((row) => row.isSelf)?.hazard ?? null)
  return useActiveRiderSignal(hazard)
}

/** The most urgent signal another Rider has active, see `topRiderSignal`, else null. */
function useOthersTopSignal(): GroupRidePin | null {
  // Picks a signal object the roster already holds, so the selector result stays stable.
  const signal = useGroupRideStore((s) =>
    s.relayClock
      ? topRiderSignal(
          s.rosterRows.flatMap((row) => (!row.isSelf && row.signal ? [row.signal] : [])),
          s.relayClock,
          (kind) => riderSignalKindInfo(kind)?.rank ?? null,
        )
      : null,
  )
  return useActiveRiderSignal(signal)
}

function signalTakeover(signal: GroupRidePin | null): IconButtonTakeover | null {
  const info = signal ? riderSignalKindInfo(signal.kind) : null
  return info ? { icon: info.icon, accent: theme.palette[info.hue].color } : null
}

/** The Rider Signal button's takeover while the own signal is live: its kind's icon and hue. */
export function useOwnSignalTakeover(): IconButtonTakeover | null {
  return signalTakeover(useOwnRiderSignal())
}

/** Social's takeover while another Rider's signal is live, so "someone needs help" never reads
 *  as the Rider's own signal, which the Rider Signal button wears instead. */
export function useOthersSignalTakeover(): IconButtonTakeover | null {
  return signalTakeover(useOthersTopSignal())
}

/** The injury ladder first, the common crash under the thumb on the right and the serious injury
 *  furthest from it (picking a higher step replaces the lower), then what broke on the board, then
 *  a wait. */
const SIGNAL_ROWS: readonly (readonly RiderSignalKind[])[] = [
  ['serious', 'minor', 'down'],
  ['battery', 'tire', 'overheat', 'board'],
  ['wait'],
]

/**
 * The Rider Signal picker, in the drawer behind Social's signal shortcut: a tile per signal kind,
 * the own active signal with its time left and "I'm OK" right under them, then the Ride Hazard
 * tiles and the own active hazard. Picking a kind replaces the active one in its slot. Sending
 * stays off without a recent GPS fix; inside a Privacy Zone it still sends, and a warning says the
 * pin reveals the position the zone otherwise hides.
 */
export function RiderSignalPicker({ onDone }: { onDone: () => void }) {
  const availability = useGroupRideStore((s) => s.signalAvailability)
  const sendSignal = useGroupRideStore((s) => s.sendSignal)
  const clearSignal = useGroupRideStore((s) => s.clearSignal)
  const sendHazard = useGroupRideStore((s) => s.sendHazard)
  const clearHazard = useGroupRideStore((s) => s.clearHazard)
  const ownSignal = useOwnRiderSignal()
  const ownHazard = useOwnRideHazard()
  const disabled = !availability.hasRecentFix
  const then = (action: () => void) => () => {
    action()
    onDone()
  }

  return (
    <View style={styles.picker}>
      <Text style={styles.section}>Signal</Text>
      <Text style={styles.hint}>
        Tell your crew what's up. They hear it and see where you are, for 10 min or until you tap
        I'm OK.
      </Text>
      {disabled ? (
        <Banner variant="info" title="Waiting for GPS…" message="Signals need your location." />
      ) : availability.insidePrivacyZone ? (
        <Banner
          variant="warning"
          title="Inside a Privacy Zone"
          message="Your position is hidden here, but a signal shows the group where you are."
        />
      ) : null}
      {SIGNAL_ROWS.map((row) => (
        <View key={row.join()} style={styles.row}>
          {row.map((kind) => (
            <PinTile
              key={kind}
              info={RIDER_SIGNAL_KIND_INFO[kind]}
              emphasis={RIDER_SIGNAL_KIND_INFO[kind].emphasis}
              disabled={disabled}
              onPress={then(() => sendSignal(kind))}
            />
          ))}
        </View>
      ))}
      {ownSignal ? (
        <OwnPin pin={ownSignal} info={riderSignalKindInfo(ownSignal.kind)}>
          <Button
            label="I'm OK"
            icon={CheckIcon}
            variant="success"
            size="sm"
            onPress={then(clearSignal)}
            accessibilityLabel="Dismiss my signal"
          />
        </OwnPin>
      ) : null}
      {availability.hazardsSupported ? (
        <>
          <Text style={styles.section}>Hazard ahead</Text>
          <Text style={styles.hint}>Pins this spot. Riders hear it when they get close.</Text>
          <View style={styles.row}>
            {RIDE_HAZARD_KINDS.map((kind: RideHazardKind) => (
              <PinTile
                key={kind}
                info={RIDE_HAZARD_KIND_INFO[kind]}
                disabled={disabled}
                onPress={then(() => sendHazard(kind))}
              />
            ))}
          </View>
          {ownHazard ? (
            <OwnPin pin={ownHazard} info={rideHazardKindInfo(ownHazard.kind)}>
              <Button
                label="Clear"
                icon={XIcon}
                variant="secondary"
                size="sm"
                onPress={then(clearHazard)}
                accessibilityLabel="Clear my hazard"
              />
            </OwnPin>
          ) : null}
        </>
      ) : null}
    </View>
  )
}

function PinTile({
  info,
  emphasis = false,
  disabled,
  onPress,
}: {
  info: PinKindInfo
  /** A faint wash and border of the kind's hue, for the injuries that need the group to act. */
  emphasis?: boolean
  disabled: boolean
  onPress: () => void
}) {
  const { label, hue } = info
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.tile,
        {
          backgroundColor: theme.control.background,
          borderColor: emphasis ? theme.alpha(theme.palette[hue].color, 0.4) : theme.control.border,
        },
        disabled && styles.disabled,
        pressed && !disabled && { opacity: interaction.pressedOpacity },
      ]}
    >
      {emphasis ? (
        <View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            styles.tileWash,
            { backgroundColor: theme.alpha(theme.palette[hue].color, 0.12) },
          ]}
        />
      ) : null}
      <PinKindBadge info={info} color={theme.palette[hue].color} size={54} strokeWidth={1.5} />
      <Text
        style={styles.tileLabel}
        numberOfLines={label.includes(' ') ? 2 : 1}
        adjustsFontSizeToFit
        minimumFontScale={0.7}
      >
        {label}
      </Text>
    </Pressable>
  )
}

/** The Rider's own active pin: its kind, time left, and the action that ends it. */
function OwnPin({
  pin,
  info,
  children,
}: {
  pin: GroupRidePin
  info: PinKindInfo | null
  children: ReactNode
}) {
  const relayClock = useGroupRideStore((s) => s.relayClock)
  if (!info) return null
  return (
    <View
      style={[
        styles.own,
        { borderColor: theme.control.border, backgroundColor: theme.control.background },
      ]}
    >
      <PinKindBadge info={info} color={theme.palette[info.hue].color} size={48} strokeWidth={1.5} />
      <View style={styles.ownText}>
        <Text style={styles.ownLabel}>{info.label}</Text>
        {relayClock ? <TimeLeft signal={pin} clock={relayClock} /> : null}
      </View>
      {children}
    </View>
  )
}

/** Time left on the relay clock, ticking every second. */
function TimeLeft({ signal, clock }: { signal: GroupRidePin; clock: RelayClock }) {
  const [leftMs, setLeftMs] = useState(() => signalTimeLeftMs(signal, clock))
  useEffect(() => {
    setLeftMs(signalTimeLeftMs(signal, clock))
    const id = setInterval(() => setLeftMs(signalTimeLeftMs(signal, clock)), 1_000)
    return () => clearInterval(id)
  }, [signal, clock])
  const totalSeconds = Math.ceil(leftMs / 1_000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = String(totalSeconds % 60).padStart(2, '0')
  return (
    <Text style={styles.ownMeta}>
      Active · {minutes}:{seconds} left
    </Text>
  )
}

const styles = StyleSheet.create({
  picker: {
    gap: 12,
  },
  hint: {
    color: theme.neutral.textMuted,
    fontSize: 13,
    lineHeight: 18,
  },
  section: {
    marginTop: 4,
    color: theme.neutral.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  row: {
    flexDirection: 'row',
    gap: 8,
  },
  tile: {
    flex: 1,
    alignItems: 'center',
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: 6,
    borderRadius: 14,
    borderWidth: 1,
  },
  tileWash: {
    borderRadius: 13,
  },
  tileLabel: {
    color: theme.neutral.textPrimary,
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
  disabled: {
    opacity: 0.4,
  },
  own: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  ownText: {
    flex: 1,
    gap: 2,
  },
  ownLabel: {
    color: theme.neutral.textPrimary,
    fontSize: 15,
    fontWeight: '700',
  },
  ownMeta: {
    color: theme.neutral.textSecondary,
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
})
