import { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native'
import { useLocalSearchParams } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import {
  BluetoothIcon,
  CheckCircleIcon,
  DeviceMobileIcon,
  LockIcon,
  WarningIcon,
} from 'phosphor-react-native'

import { Button } from '@/components/base/Button'
import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'
import {
  addOwCharacteristicListener,
  addOwStateListener,
  owConnect,
  owDisconnect,
  type OwCharacteristicEvent,
  type OwStateEvent,
} from 'vescape-core'

/**
 * OneWheel PoC: raw dump of every GATT characteristic the board exposes, live. Speed and battery
 * (the two metrics we actually want) are pinned above the dump.
 */
export function OwDebugScreen() {
  const params = useLocalSearchParams<{ bleId?: string; name?: string }>()
  const bleId = params.bleId ?? null
  const [connectRequested, setConnectRequested] = useState(false)
  const [state, setState] = useState<OwStateEvent | null>(null)
  const [chars, setChars] = useState<Record<string, OwCharacteristicEvent>>({})

  useEffect(() => {
    if (!bleId || !connectRequested) return
    const stateSub = addOwStateListener(setState)
    const charSub = addOwCharacteristicListener((event) => {
      setChars((prev) => ({ ...prev, [event.uuid]: event }))
    })
    owConnect(bleId)
    return () => {
      stateSub.remove()
      charSub.remove()
      owDisconnect()
    }
  }, [bleId, connectRequested])

  const sortedChars = useMemo(
    () => Object.values(chars).sort((a, b) => a.shortId.localeCompare(b.shortId)),
    [chars],
  )

  const phase = state?.phase ?? 'connecting'

  if (!connectRequested) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <ScrollView contentContainerStyle={styles.content}>
          <BoardHeader name={params.name} bleId={bleId} />

          <View style={styles.prepareBanner}>
            <DeviceMobileIcon size={20} color={theme.status.info.color} weight="duotone" />
            <View style={styles.prepareCopy}>
              <Text style={styles.prepareTitle}>Prepare in the Onewheel app first</Text>
              <Text style={styles.prepareText}>
                Vescape remembered this board and will not connect yet. It is safe if the board
                disappears from the scan list while the official app is using it.
              </Text>
            </View>
          </View>

          <View style={styles.steps}>
            <PreparationStep number="1" text="Open the official Onewheel app." />
            <PreparationStep
              number="2"
              text="Connect to this board and wait until today’s riding mode has loaded."
            />
            <PreparationStep number="3" text="Return to Vescape, then connect below." />
          </View>

          <Button
            label="Connect in Vescape"
            icon={BluetoothIcon}
            disabled={!bleId}
            onPress={() => setConnectRequested(true)}
            testID="ow-preparation-connect"
          />
          {!bleId ? (
            <Text style={styles.missingDevice}>No remembered Bluetooth device. Scan again.</Text>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <BoardHeader name={params.name} bleId={bleId} />
          {(phase === 'connecting' || phase === 'unlocking') && (
            <ActivityIndicator color={theme.palette.sky.color} size="small" />
          )}
        </View>

        {phase === 'locked' && (
          <View style={styles.warnCard}>
            <LockIcon size={16} color={theme.palette.amber.light} weight="duotone" />
            <Text style={styles.warnText}>{state?.message}</Text>
          </View>
        )}
        {phase === 'error' && (
          <View style={styles.errorCard}>
            <WarningIcon size={16} color={theme.palette.red.light} weight="duotone" />
            <Text style={styles.errorText}>{state?.message ?? 'Connection failed'}</Text>
          </View>
        )}
        {(phase === 'locked' || phase === 'error' || phase === 'disconnected') && bleId && (
          <Button label="Reconnect" onPress={() => owConnect(bleId)} testID="ow-reconnect" />
        )}

        <View style={styles.metricsRow}>
          <View style={styles.metricCard}>
            <Text style={styles.metricValue}>
              {state?.speedKmh != null ? state.speedKmh.toFixed(1) : '—'}
            </Text>
            <Text style={styles.metricLabel}>km/h</Text>
          </View>
          <View style={styles.metricCard}>
            <Text style={styles.metricValue}>
              {state?.batteryPercent != null ? `${state.batteryPercent}` : '—'}
            </Text>
            <Text style={styles.metricLabel}>battery %</Text>
          </View>
        </View>

        <View style={styles.infoCard}>
          <InfoRow label="state" value={phase} />
          <InfoRow label="firmware" value={state?.firmwareRevision} />
          <InfoRow label="hardware" value={state?.hardwareRevision} />
          <InfoRow label="serial" value={state?.serial} />
          <InfoRow label="ride mode" value={state?.rideMode} />
        </View>

        <Text style={styles.sectionTitle}>Characteristics ({sortedChars.length})</Text>
        <View style={styles.infoCard}>
          {sortedChars.length === 0 && (
            <Text style={styles.emptyText}>Waiting for board data…</Text>
          )}
          {sortedChars.map((char) => (
            <View key={char.uuid} style={styles.charRow}>
              <View style={styles.charHeader}>
                <Text style={styles.charName}>{char.name}</Text>
                <Text style={styles.charId}>{char.shortId}</Text>
              </View>
              <Text style={styles.charDisplay} selectable>
                {char.display}
              </Text>
              <Text style={styles.charHex} selectable>
                {char.hex}
              </Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

function BoardHeader({ name, bleId }: { name?: string; bleId: string | null }) {
  return (
    <View style={styles.boardHeader}>
      <BluetoothIcon size={20} color={theme.palette.sky.color} weight="duotone" />
      <View style={styles.headerText}>
        <Text style={styles.title}>{name || bleId || 'OneWheel'}</Text>
        <Text style={styles.subtitle}>{bleId}</Text>
      </View>
    </View>
  )
}

function PreparationStep({ number, text }: { number: string; text: string }) {
  return (
    <View style={styles.prepareStep}>
      <View style={styles.stepNumber}>
        <Text style={styles.stepNumberText}>{number}</Text>
      </View>
      <Text style={styles.stepText}>{text}</Text>
      <CheckCircleIcon size={18} color={theme.palette.slate.textDim} weight="regular" />
    </View>
  )
}

function InfoRow({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value ?? '—'}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.palette.slate.bg,
  },
  content: {
    padding: 16,
    gap: 14,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  boardHeader: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerText: {
    flex: 1,
    gap: 2,
  },
  title: {
    color: theme.palette.slate.textPrimary,
    fontSize: 20,
    fontWeight: '800',
  },
  subtitle: {
    color: theme.palette.slate.textMuted,
    fontSize: 12,
    fontFamily: 'monospace',
  },
  prepareBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: theme.status.info.bg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.status.info.border,
    padding: 14,
  },
  prepareCopy: {
    flex: 1,
    gap: 5,
  },
  prepareTitle: {
    color: theme.status.info.text,
    fontSize: 15,
    fontWeight: '700',
  },
  prepareText: {
    color: theme.palette.slate.textSecondary,
    fontSize: 13,
    lineHeight: 19,
  },
  steps: {
    gap: 12,
    paddingVertical: 4,
  },
  prepareStep: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  stepNumber: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: theme.status.info.border,
  },
  stepNumberText: {
    color: theme.status.info.text,
    fontSize: 13,
    fontWeight: '800',
  },
  stepText: {
    flex: 1,
    color: theme.palette.slate.textSecondary,
    fontSize: 14,
    lineHeight: 19,
  },
  missingDevice: {
    color: theme.status.error.text,
    fontSize: 13,
    textAlign: 'center',
  },
  warnCard: {
    flexDirection: 'row',
    gap: 8,
    backgroundColor: theme.palette.amber.bg,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.palette.amber.border,
    padding: 12,
  },
  warnText: {
    flex: 1,
    color: theme.palette.amber.text,
    fontSize: 13,
    lineHeight: 18,
  },
  errorCard: {
    flexDirection: 'row',
    gap: 8,
    backgroundColor: theme.palette.red.bg,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.palette.red.border,
    padding: 12,
  },
  errorText: {
    flex: 1,
    color: theme.palette.red.text,
    fontSize: 13,
    lineHeight: 18,
  },
  metricsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  metricCard: {
    flex: 1,
    backgroundColor: theme.palette.slate.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.palette.slate.border,
    paddingVertical: 18,
    alignItems: 'center',
    gap: 4,
  },
  metricValue: {
    color: theme.palette.slate.textPrimary,
    fontSize: 32,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  metricLabel: {
    color: theme.palette.slate.textMuted,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  infoCard: {
    backgroundColor: theme.palette.slate.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.palette.slate.border,
    overflow: 'hidden',
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.palette.slate.border,
  },
  infoLabel: {
    color: theme.palette.slate.textMuted,
    fontSize: 12,
    fontFamily: 'monospace',
  },
  infoValue: {
    color: theme.palette.slate.textSecondary,
    fontSize: 12,
    fontFamily: 'monospace',
  },
  sectionTitle: {
    color: theme.palette.slate.textMuted,
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginLeft: 4,
  },
  emptyText: {
    color: theme.palette.slate.textDim,
    fontSize: 13,
    padding: 14,
  },
  charRow: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 3,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.palette.slate.border,
  },
  charHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  charName: {
    color: theme.palette.slate.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
  charId: {
    color: theme.palette.slate.textDim,
    fontSize: 11,
    fontFamily: 'monospace',
  },
  charDisplay: {
    color: theme.palette.sky.light,
    fontSize: 13,
    fontFamily: 'monospace',
  },
  charHex: {
    color: theme.palette.slate.textDim,
    fontSize: 11,
    fontFamily: 'monospace',
  },
})
