import { useEffect, useRef, useState } from 'react'
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import { CheckIcon, MegaphoneIcon } from 'phosphor-react-native'
import type { GroupRideSignal } from 'vescape-core'

import { Button } from '@/components/base/Button'
import { IconButton } from '@/components/base/IconButton'
import { Text } from '@/components/base/Text'
import { EdgeDrawer } from '@/components/overlays/EdgeDrawer'
import { theme } from '@/constants/theme'
import {
  RIDER_SIGNAL_KINDS,
  RIDER_SIGNAL_KIND_INFO,
  riderSignalKindInfo,
} from '@/modules/group-ride/constants/riderSignalKinds'
import { signalTimeLeftMs, type RelayClock } from '@/modules/group-ride/lib/riderSignal'
import { useGroupRideStore } from '@/modules/group-ride/store/groupRideStore'

/** The device's own active Rider Signal, from the relay's roster. */
function useOwnSignal(): GroupRideSignal | null {
  return useGroupRideStore((s) => s.rosterRows.find((row) => row.isSelf)?.signal ?? null)
}

/**
 * 📣 while joined to a Group Ride, opening the signal picker. Hidden against a relay that does not
 * advertise signals, which would reject them. Red while the Rider's own signal is active.
 */
export function RiderSignalTrigger({ style }: { style?: StyleProp<ViewStyle> }) {
  const triggerRef = useRef<View>(null)
  const [open, setOpen] = useState(false)
  const shown = useGroupRideStore((s) => s.activeRideId !== null && s.signalAvailability.supported)
  const ownSignalActive = useOwnSignal() !== null
  if (!shown) return null
  return (
    <>
      <View ref={triggerRef} collapsable={false} style={style}>
        <IconButton
          icon={MegaphoneIcon}
          onPress={() => setOpen(true)}
          accessibilityLabel="Rider signal"
          accent={ownSignalActive ? theme.palette.red.color : undefined}
        />
      </View>
      <EdgeDrawer
        visible={open}
        triggerRef={triggerRef}
        edge="top"
        title="Rider signal"
        icon={MegaphoneIcon}
        onClose={() => setOpen(false)}
      >
        <RiderSignalSheet onSent={() => setOpen(false)} />
      </EdgeDrawer>
    </>
  )
}

/**
 * The Rider Signal picker: the own active signal with its time left and a dismiss, then the fixed
 * kinds. Picking a kind replaces the active one. Sending stays off without a recent GPS fix; inside
 * a Privacy Zone it still sends, and the hint warns that it shares the Rider's location.
 */
function RiderSignalSheet({ onSent }: { onSent: () => void }) {
  const availability = useGroupRideStore((s) => s.signalAvailability)
  const sendSignal = useGroupRideStore((s) => s.sendSignal)
  const ownSignal = useOwnSignal()

  const blockedReason = availability.hasRecentFix ? null : 'Waiting for GPS…'
  const hint =
    blockedReason ??
    (availability.insidePrivacyZone
      ? 'Sending shares your location, even inside a Privacy Zone.'
      : 'Everyone in the group ride sees it where you are now.')

  return (
    <View style={styles.sheet}>
      {ownSignal ? <OwnSignal signal={ownSignal} /> : null}
      <Text style={styles.hint}>{hint}</Text>
      <View style={styles.kinds}>
        {RIDER_SIGNAL_KINDS.map((kind) => {
          const { label, icon } = RIDER_SIGNAL_KIND_INFO[kind]
          return (
            <Button
              key={kind}
              label={label}
              icon={icon}
              variant={kind === 'down' || kind === 'help' ? 'destructive' : 'caution'}
              disabled={blockedReason !== null}
              onPress={() => {
                sendSignal(kind)
                onSent()
              }}
              accessibilityLabel={`Signal: ${label}`}
            />
          )
        })}
      </View>
    </View>
  )
}

function OwnSignal({ signal }: { signal: GroupRideSignal }) {
  const relayClock = useGroupRideStore((s) => s.relayClock)
  const clearSignal = useGroupRideStore((s) => s.clearSignal)
  const info = riderSignalKindInfo(signal.kind)
  if (!info) return null
  const KindIcon = info.icon
  return (
    <View style={styles.own}>
      <KindIcon size={20} color={theme.palette.red.color} weight="fill" />
      <View style={styles.ownText}>
        <Text style={styles.ownLabel}>{info.label}</Text>
        {relayClock ? <TimeLeft signal={signal} clock={relayClock} /> : null}
      </View>
      <Button
        label="I'm OK"
        icon={CheckIcon}
        variant="success"
        size="sm"
        onPress={clearSignal}
        accessibilityLabel="Dismiss my signal"
      />
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
  sheet: {
    gap: 12,
  },
  hint: {
    color: theme.neutral.textSecondary,
    fontSize: 13,
  },
  kinds: {
    gap: 8,
  },
  own: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.palette.red.border,
    backgroundColor: theme.palette.red.bg,
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
