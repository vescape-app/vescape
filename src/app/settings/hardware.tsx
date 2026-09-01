import { useMemo, useState } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useShallow } from 'zustand/react/shallow'
import { CpuIcon } from 'phosphor-react-native'

import { theme } from '@/constants/theme'
import { Text } from '@/components/base/Text'
import { Button } from '@/components/base/Button'
import { DeviceRow } from '@/components/base/DeviceRow'
import { Input } from '@/components/forms/Input'
import { ChartStack } from '@/components/charts/line/ChartStack'
import { IconHero } from '@/components/settings/IconHero'
import { SettingsCard } from '@/components/settings/SettingsCard'
import { SettingsSectionTitle } from '@/components/settings/SettingsSectionTitle'
import { usePermissions } from '@/modules/settings/hooks/usePermissions'
import { useHardwareLink } from '@/modules/hardware/hooks/useHardwareLink'
import { buildSensorCharts } from '@/modules/hardware/lib/sensorCharts'
import { describeReadings } from '@/modules/hardware/lib/sensorReadings'
import { useHardwareStore } from '@/modules/hardware/store/hardwareStore'

const PHASE_LABEL = {
  idle: 'Not connected',
  scanning: 'Scanning',
  connecting: 'Connecting',
  connected: 'Connected',
  error: 'Error',
} as const

const PHASE_COLOR = {
  idle: theme.neutral.textMuted,
  scanning: theme.palette.sky.color,
  connecting: theme.palette.amber.color,
  connected: theme.palette.green.color,
  error: theme.status.error.color,
} as const

const LINE_PREFIX = { rx: '<', tx: '>', error: '!' } as const

const LINE_COLOR = {
  rx: theme.palette.green.text,
  tx: theme.neutral.textMuted,
  error: theme.status.error.text,
} as const

/**
 * Hardware Link console for the ESP32-S3 running the `vescape-hardware` firmware. Android-only for
 * now; the settings row that leads here is hidden on iOS.
 */
export default function HardwareSettingsScreen() {
  const link = useHardwareLink()
  const permissions = usePermissions()
  const [draft, setDraft] = useState('')
  const { phase, deviceName, deviceId, error, devices, lines, frames } = useHardwareStore(
    useShallow((s) => ({
      phase: s.phase,
      frames: s.frames,
      deviceName: s.deviceName,
      deviceId: s.deviceId,
      error: s.error,
      devices: s.devices,
      lines: s.lines,
    })),
  )

  const readings = useMemo(() => describeReadings(frames), [frames])
  const charts = useMemo(() => buildSensorCharts(frames), [frames])

  const connected = phase === 'connected'
  const scanning = phase === 'scanning'

  const startScan = async () => {
    await permissions.request()
    link.scan()
  }

  const send = () => {
    const text = draft.trim()
    if (!text) return
    void link.send(text)
    setDraft('')
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <IconHero
          icon={CpuIcon}
          iconColor={theme.palette.cyan.color}
          description="Connect to a Vescape hardware board over Bluetooth and talk to it directly."
        />

        <SettingsCard separatorInset={0}>
          <View style={styles.status}>
            <Text style={[styles.phase, { color: PHASE_COLOR[phase] }]}>{PHASE_LABEL[phase]}</Text>
            <Text style={styles.device}>{deviceName ?? deviceId ?? 'No device'}</Text>
            {error ? <Text style={styles.error}>{error}</Text> : null}
          </View>
        </SettingsCard>

        <View style={styles.actions}>
          <Button
            label={scanning ? 'Stop scan' : 'Scan'}
            variant="secondary"
            onPress={scanning ? link.stopScan : startScan}
            style={styles.action}
          />
          <Button
            label="Disconnect"
            variant="destructive"
            disabled={!connected && phase !== 'connecting'}
            onPress={link.disconnect}
            style={styles.action}
          />
        </View>

        {devices.length > 0 && !connected ? (
          <>
            <SettingsSectionTitle>Devices</SettingsSectionTitle>
            {devices.map((device) => (
              <DeviceRow
                key={device.id}
                id={device.id}
                name={device.name}
                rssi={device.rssi}
                onPress={() => link.connect(device.id)}
              />
            ))}
          </>
        ) : null}

        {readings.length > 0 ? (
          <>
            <SettingsSectionTitle>Readings</SettingsSectionTitle>
            <SettingsCard separatorInset={16}>
              {readings.map((reading) => (
                <View key={reading.key} style={styles.reading}>
                  <Text style={styles.readingLabel}>{reading.label}</Text>
                  <Text style={styles.readingValue}>{reading.text}</Text>
                </View>
              ))}
            </SettingsCard>
          </>
        ) : null}

        {charts.length > 0 ? (
          <>
            <SettingsSectionTitle>History</SettingsSectionTitle>
            <SettingsCard separatorInset={0}>
              <ChartStack
                charts={charts}
                dataKey={deviceId ?? 'hardware'}
                follow
                timeMode="relative"
                showHead
                containerStyle={styles.charts}
              />
            </SettingsCard>
          </>
        ) : null}

        {connected ? (
          <>
            <SettingsSectionTitle>Send</SettingsSectionTitle>
            <View style={styles.actions}>
              <Input
                value={draft}
                onChangeText={setDraft}
                placeholder="Text to send"
                autoCapitalize="none"
                autoCorrect={false}
                onSubmitEditing={send}
                returnKeyType="send"
                style={styles.input}
              />
              <Button label="Send" onPress={send} disabled={draft.trim().length === 0} />
            </View>
          </>
        ) : null}

        {lines.length > 0 ? (
          <>
            <SettingsSectionTitle>Console</SettingsSectionTitle>
            <SettingsCard separatorInset={0}>
              {lines.map((line, index) => (
                <Text
                  key={`${line.atMs}-${index}`}
                  style={[styles.line, { color: LINE_COLOR[line.direction] }]}
                >
                  {LINE_PREFIX[line.direction]} {line.text}
                </Text>
              ))}
            </SettingsCard>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.neutral.bg,
  },
  content: {
    padding: 16,
    gap: 8,
  },
  status: {
    padding: 16,
    gap: 4,
  },
  phase: {
    fontSize: 16,
    fontWeight: '700',
  },
  device: {
    fontSize: 13,
    color: theme.neutral.textMuted,
  },
  error: {
    fontSize: 13,
    color: theme.status.error.text,
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  action: {
    flex: 1,
  },
  input: {
    flex: 1,
  },
  charts: {
    paddingVertical: 12,
    paddingRight: 12,
  },
  reading: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  readingLabel: {
    fontSize: 15,
    color: theme.neutral.textMuted,
  },
  readingValue: {
    fontSize: 15,
    fontWeight: '600',
    color: theme.neutral.textPrimary,
  },
  line: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    fontSize: 13,
  },
})
