import { useEffect, useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { CheckIcon } from 'phosphor-react-native'
import type { GroupRideSignal, RiderSignalKind } from 'vescape-core'

import { Banner } from '@/components/base/Banner'
import { Button } from '@/components/base/Button'
import type { IconButtonTakeover } from '@/components/base/IconButton'
import { Text } from '@/components/base/Text'
import { interaction, theme } from '@/constants/theme'
import { useResolvedAccentColors } from '@/hooks/useTheme'
import {
  RIDER_SIGNAL_KIND_INFO,
  riderSignalHue,
  riderSignalKindInfo,
} from '@/modules/group-ride/constants/riderSignalKinds'
import { useActiveRiderSignal } from '@/modules/group-ride/hooks/useActiveRiderSignal'
import {
  signalTimeLeftMs,
  topRiderSignal,
  type RelayClock,
} from '@/modules/group-ride/lib/riderSignal'
import { useGroupRideStore } from '@/modules/group-ride/store/groupRideStore'

/** The device's own Rider Signal while it is active on the relay clock, else null. */
export function useOwnRiderSignal(): GroupRideSignal | null {
  const signal = useGroupRideStore((s) => s.rosterRows.find((row) => row.isSelf)?.signal ?? null)
  return useActiveRiderSignal(signal)
}

/** The most urgent signal another Rider has active, see `topRiderSignal`, else null. */
function useOthersTopSignal(): GroupRideSignal | null {
  // Picks a signal object the roster already holds, so the selector result stays stable.
  const signal = useGroupRideStore((s) =>
    s.relayClock
      ? topRiderSignal(
          s.rosterRows.flatMap((row) => (!row.isSelf && row.signal ? [row.signal] : [])),
          s.relayClock,
          (kind) => riderSignalKindInfo(kind)?.critical ?? null,
        )
      : null,
  )
  return useActiveRiderSignal(signal)
}

function signalTakeover(signal: GroupRideSignal | null): IconButtonTakeover | null {
  const info = signal ? riderSignalKindInfo(signal.kind) : null
  return info ? { icon: info.icon, accent: theme.palette[riderSignalHue(info)].color } : null
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

/** Critical kinds lead on a row of their own; the rest share the row below. */
const CRITICAL_KINDS = (Object.keys(RIDER_SIGNAL_KIND_INFO) as RiderSignalKind[]).filter(
  (kind) => RIDER_SIGNAL_KIND_INFO[kind].critical,
)
const OTHER_KINDS = (Object.keys(RIDER_SIGNAL_KIND_INFO) as RiderSignalKind[]).filter(
  (kind) => !RIDER_SIGNAL_KIND_INFO[kind].critical,
)

/**
 * The Rider Signal picker, in the drawer behind Social's signal shortcut: the own active signal with its time left
 * and a dismiss, then a tile per kind. Picking a kind replaces the active one. Sending stays off
 * without a recent GPS fix; inside a Privacy Zone it still sends, and a warning says the signal
 * reveals the position the zone otherwise hides.
 */
export function RiderSignalPicker({ onDone }: { onDone: () => void }) {
  const availability = useGroupRideStore((s) => s.signalAvailability)
  const sendSignal = useGroupRideStore((s) => s.sendSignal)
  const ownSignal = useOwnRiderSignal()
  const disabled = !availability.hasRecentFix

  const send = (kind: RiderSignalKind) => {
    sendSignal(kind)
    onDone()
  }

  return (
    <View style={styles.picker}>
      {ownSignal ? <OwnSignal signal={ownSignal} onCleared={onDone} /> : null}
      {disabled ? (
        <Banner variant="info" title="Waiting for GPS…" message="Signals need your location." />
      ) : availability.insidePrivacyZone ? (
        <Banner
          variant="warning"
          title="Inside a Privacy Zone"
          message="Your position is hidden here, but a signal shows the group where you are."
        />
      ) : null}
      <View style={styles.row}>
        {CRITICAL_KINDS.map((kind) => (
          <SignalTile key={kind} kind={kind} disabled={disabled} onPress={() => send(kind)} />
        ))}
      </View>
      <View style={styles.row}>
        {OTHER_KINDS.map((kind) => (
          <SignalTile key={kind} kind={kind} disabled={disabled} onPress={() => send(kind)} />
        ))}
      </View>
    </View>
  )
}

function SignalTile({
  kind,
  disabled,
  onPress,
}: {
  kind: RiderSignalKind
  disabled: boolean
  onPress: () => void
}) {
  const accents = useResolvedAccentColors()
  const info = RIDER_SIGNAL_KIND_INFO[kind]
  const { label, icon: KindIcon } = info
  const hue = riderSignalHue(info)
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={`Signal: ${label}`}
      style={({ pressed }) => [
        styles.tile,
        { backgroundColor: theme.control.background, borderColor: theme.control.border },
        disabled && styles.disabled,
        pressed && !disabled && { opacity: interaction.pressedOpacity },
      ]}
    >
      <View
        style={[
          styles.tileIcon,
          { backgroundColor: accents[hue].bg, borderColor: accents[hue].border },
        ]}
      >
        <KindIcon size={22} color={theme.palette[hue].color} weight="bold" />
      </View>
      <Text style={styles.tileLabel} numberOfLines={2}>
        {label}
      </Text>
    </Pressable>
  )
}

/** Dismisses the Rider's own active signal. */
function ImOkButton({ onCleared }: { onCleared: () => void }) {
  const clearSignal = useGroupRideStore((s) => s.clearSignal)
  return (
    <Button
      label="I'm OK"
      icon={CheckIcon}
      variant="success"
      size="sm"
      onPress={() => {
        clearSignal()
        onCleared()
      }}
      accessibilityLabel="Dismiss my signal"
    />
  )
}

function OwnSignal({ signal, onCleared }: { signal: GroupRideSignal; onCleared: () => void }) {
  const relayClock = useGroupRideStore((s) => s.relayClock)
  const accents = useResolvedAccentColors()
  const info = riderSignalKindInfo(signal.kind)
  if (!info) return null
  const KindIcon = info.icon
  const hue = riderSignalHue(info)
  return (
    <View
      style={[
        styles.own,
        { borderColor: theme.palette[hue].color, backgroundColor: theme.control.background },
      ]}
    >
      <View
        style={[
          styles.ownIcon,
          { backgroundColor: accents[hue].bg, borderColor: accents[hue].border },
        ]}
      >
        <KindIcon size={20} color={theme.palette[hue].color} weight="bold" />
      </View>
      <View style={styles.ownText}>
        <Text style={styles.ownLabel}>{info.label}</Text>
        {relayClock ? <TimeLeft signal={signal} clock={relayClock} /> : null}
      </View>
      <ImOkButton onCleared={onCleared} />
    </View>
  )
}

/** Time left on the relay clock, ticking every second. */
function TimeLeft({ signal, clock }: { signal: GroupRideSignal; clock: RelayClock }) {
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
  tileIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
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
  ownIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
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
