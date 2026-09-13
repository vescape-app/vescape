import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, FlatList, StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { PlugsConnectedIcon } from 'phosphor-react-native'
import { useShallow } from 'zustand/react/shallow'

import { Text } from '@/components/base/Text'
import { DeviceRow } from '@/components/base/DeviceRow'
import { IconHero } from '@/components/settings/IconHero'
import { AccessoryCompatibilityNotice } from '@/modules/accessories/components/AccessoryCompatibilityNotice'
import { AccessoryCapabilityRow } from '@/modules/accessories/components/AccessoryCapabilityRow'
import { inspectionErrorCopy } from '@/modules/accessories/lib/accessoryStatus'
import { useAccessoryDiscoveryStore } from '@/modules/accessories/store/accessoryDiscoveryStore'
import { usePermissions } from '@/modules/settings/hooks/usePermissions'
import { theme } from '@/constants/theme'
import type { AccessoryInspection } from 'vescape-core'

/**
 * Finding an Accessory and reading what it is.
 *
 * Every row here is a device advertising the Vescape Accessory service — matched on the service,
 * never the name, so a renamed accessory is still found and a namesake is not mistaken for one.
 * Picking one performs the discovery handshake and shows its identity, protocol version and
 * capabilities. Nothing is enrolled and nothing is commanded: the app disconnects as soon as the
 * manifest is read.
 */
export function AccessoryScanScreen({
  onOpenAccessory,
}: {
  /** Called with a persistent Accessory id once one has answered with a manifest. */
  onOpenAccessory: (accessoryId: string) => void
}) {
  const { status, request } = usePermissions()
  const { devices, scanning, scanError, inspecting, startScan, stopScan, inspect } =
    useAccessoryDiscoveryStore(
      useShallow((s) => ({
        devices: s.devices,
        scanning: s.scanning,
        scanError: s.scanError,
        inspecting: s.inspecting,
        startScan: s.startScan,
        stopScan: s.stopScan,
        inspect: s.inspect,
      })),
    )
  const [result, setResult] = useState<AccessoryInspection | null>(null)

  useEffect(() => {
    void request()
  }, [request])

  useEffect(() => {
    if (status === 'granted') startScan()
    return () => stopScan()
  }, [status, startScan, stopScan])

  const onSelect = useCallback(
    async (deviceId: string) => {
      setResult(null)
      const inspection = await inspect(deviceId)
      setResult(inspection)
      // Straight through on success: the rider picked a device to configure, not to read about.
      if (inspection.manifest) onOpenAccessory(inspection.manifest.accessoryId)
    },
    [inspect, onOpenAccessory],
  )

  const subtitle =
    status === 'denied'
      ? 'Bluetooth permission required'
      : scanError === 'bluetooth-unavailable'
        ? 'Bluetooth is off or unavailable'
        : scanError === 'scan-failed'
          ? 'The scan could not start'
          : inspecting
            ? 'Reading the accessory…'
            : scanning
              ? 'Scanning for accessories…'
              : 'Scan stopped'

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <FlatList
        data={devices}
        keyExtractor={(device) => device.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <DeviceRow
            id={item.id}
            name={item.name ?? 'Unnamed accessory'}
            rssi={item.rssi}
            onPress={() => void onSelect(item.id)}
          />
        )}
        ListHeaderComponent={
          <View style={styles.header}>
            <IconHero
              icon={PlugsConnectedIcon}
              description="Accessories are found by the service they advertise, not by their name."
            />
            <View style={styles.statusLine}>
              {(scanning || inspecting) && (
                <ActivityIndicator color={theme.palette.sky.color} size="small" />
              )}
              <Text style={styles.subtitle}>{subtitle}</Text>
            </View>
            {result && !result.manifest && result.error ? (
              <Text style={styles.error}>
                {result.advertisedName ?? result.deviceId}: {inspectionErrorCopy(result.error)}
              </Text>
            ) : null}
            {result?.manifest ? (
              <View style={styles.preview}>
                <AccessoryCompatibilityNotice
                  compatibility={result.manifest.compatibility}
                  supportedVersions={result.manifest.supportedVersions}
                />
                {result.manifest.capabilities.map((capability) => (
                  <AccessoryCapabilityRow key={capability.id} capability={capability} />
                ))}
              </View>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          scanning ? (
            <Text style={styles.empty}>Accessories will appear here as they are found</Text>
          ) : null
        }
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.neutral.bg },
  list: { padding: 16, flexGrow: 1 },
  header: { gap: 12, marginBottom: 12 },
  statusLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  subtitle: { color: theme.neutral.textSecondary, fontSize: 14 },
  error: { color: theme.status.error.text, fontSize: 13, lineHeight: 18 },
  preview: { gap: 8 },
  empty: {
    color: theme.neutral.textDim,
    textAlign: 'center',
    marginTop: 40,
    fontSize: 14,
  },
})
