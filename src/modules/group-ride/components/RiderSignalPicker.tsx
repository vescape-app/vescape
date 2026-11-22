import type { ReactNode } from 'react'
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
import { useResolvedNeutralColors } from '@/hooks/useTheme'
import {
  RIDE_HAZARD_KIND_INFO,
  RIDER_SIGNAL_KIND_INFO,
  rideHazardKindInfo,
  riderSignalKindInfo,
  type PinKindInfo,
} from '@/modules/group-ride/constants/riderSignalKinds'
import { useActiveRiderSignal } from '@/modules/group-ride/hooks/useActiveRiderSignal'
import { topRiderSignal } from '@/modules/group-ride/lib/riderSignal'
import { PinKindBadge } from '@/modules/group-ride/components/PinKindBadge'
import { ownPin, useGroupRideStore } from '@/modules/group-ride/store/groupRideStore'

export function useOwnRiderSignal(): GroupRidePin | null {
  return useActiveRiderSignal(useGroupRideStore((s) => ownPin(s, 'signal')))
}

function useOwnRideHazard(): GroupRidePin | null {
  return useActiveRiderSignal(useGroupRideStore((s) => ownPin(s, 'hazard')))
}

function useOthersTopSignal(): GroupRidePin | null {
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

export function useOwnSignalTakeover(): IconButtonTakeover | null {
  return signalTakeover(useOwnRiderSignal())
}

export function useOthersSignalTakeover(): IconButtonTakeover | null {
  return signalTakeover(useOthersTopSignal())
}

const SIGNAL_ROWS: readonly (readonly RiderSignalKind[])[] = [
  ['serious', 'minor', 'down'],
  ['battery', 'tire', 'overheat', 'board'],
  ['wait', 'break'],
]

export function RiderSignalPicker({ onDone }: { onDone: () => void }) {
  const availability = useGroupRideStore((s) => s.signalAvailability)
  const sendSignal = useGroupRideStore((s) => s.sendSignal)
  const clearSignal = useGroupRideStore((s) => s.clearSignal)
  const sendHazard = useGroupRideStore((s) => s.sendHazard)
  const clearHazard = useGroupRideStore((s) => s.clearHazard)
  const ownSignal = useOwnRiderSignal()
  const ownHazard = useOwnRideHazard()
  const needsLocation = !availability.hasRecentFix
  const signalDisabled = needsLocation || ownSignal !== null
  const privacyWarning = availability.insidePrivacyZone ? (
    <View style={styles.privacyWarning}>
      <Banner
        variant="warning"
        title="Inside a Privacy Zone"
        message="Your position is hidden here, but a signal shows the group where you are."
      />
    </View>
  ) : null
  const then = (action: () => void) => () => {
    action()
    onDone()
  }

  return (
    <View style={styles.picker}>
      <Text style={styles.section}>Signal</Text>
      <Text style={styles.hint}>
        Tell your crew what's up. They hear it and see where you are until you tap I'm OK.
      </Text>
      {needsLocation ? (
        <Banner variant="info" title="Waiting for GPS…" message="Signals need your location." />
      ) : ownSignal ? null : (
        privacyWarning
      )}
      <View>
        <View
          style={styles.picker}
          accessibilityElementsHidden={ownSignal !== null}
          importantForAccessibility={ownSignal ? 'no-hide-descendants' : 'auto'}
        >
          {SIGNAL_ROWS.map((row) => (
            <View key={row.join()} style={styles.row}>
              {row.map((kind) => (
                <PinTile
                  key={kind}
                  info={RIDER_SIGNAL_KIND_INFO[kind]}
                  emphasis={RIDER_SIGNAL_KIND_INFO[kind].emphasis}
                  disabled={signalDisabled}
                  onPress={then(() => sendSignal(kind))}
                />
              ))}
            </View>
          ))}
        </View>
        {ownSignal ? (
          <View style={styles.signalOverlay} pointerEvents="box-none">
            <OwnPin info={riderSignalKindInfo(ownSignal.kind)} notice={privacyWarning}>
              <Button
                label="I'm OK"
                icon={CheckIcon}
                variant="success"
                size="sm"
                onPress={clearSignal}
                accessibilityLabel="Dismiss my signal"
              />
            </OwnPin>
          </View>
        ) : null}
      </View>
      {availability.hazardsSupported ? (
        <>
          <Text style={styles.section}>Hazard ahead</Text>
          <Text style={styles.hint}>Pins this spot. Riders hear it when they get close.</Text>
          <View style={styles.row}>
            {RIDE_HAZARD_KINDS.map((kind: RideHazardKind) => (
              <PinTile
                key={kind}
                info={RIDE_HAZARD_KIND_INFO[kind]}
                disabled={needsLocation}
                onPress={then(() => sendHazard(kind))}
              />
            ))}
          </View>
          {ownHazard ? (
            <OwnPin info={rideHazardKindInfo(ownHazard.kind)}>
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
      accessibilityState={{ disabled }}
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

function OwnPin({
  info,
  children,
  notice,
}: {
  info: PinKindInfo | null
  children: ReactNode
  notice?: ReactNode
}) {
  const neutral = useResolvedNeutralColors()
  if (!info) return null
  return (
    <View style={[styles.own, { borderColor: neutral.border, backgroundColor: neutral.surface }]}>
      <View style={styles.ownRow}>
        <PinKindBadge
          info={info}
          color={theme.palette[info.hue].color}
          size={48}
          strokeWidth={1.5}
        />
        <View style={styles.ownText}>
          <Text style={styles.ownLabel}>{info.label}</Text>
          <Text style={styles.ownMeta}>Active</Text>
        </View>
        {children}
      </View>
      {notice}
    </View>
  )
}

const styles = StyleSheet.create({
  picker: {
    gap: 12,
  },
  privacyWarning: { paddingTop: 8 },
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
  signalOverlay: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  own: {
    gap: 18,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  ownRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
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
  },
})
