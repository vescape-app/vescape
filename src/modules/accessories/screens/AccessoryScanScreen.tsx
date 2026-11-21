import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, FlatList, StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useShallow } from 'zustand/react/shallow'

import { Text } from '@/components/base/Text'
import { DeviceRow } from '@/components/base/DeviceRow'
import { IconHero } from '@/components/settings/IconHero'
import { AccessoryCompatibilityNotice } from '@/modules/accessories/components/AccessoryCompatibilityNotice'
import { AccessoryCapabilityRow } from '@/modules/accessories/components/AccessoryCapabilityRow'
import { AccessoryIcon } from '@/modules/accessories/constants/accessoryIcon'
import { inspectionErrorCopy } from '@/modules/accessories/lib/accessoryStatus'
import { useAccessoryDiscoveryStore } from '@/modules/accessories/store/accessoryDiscoveryStore'
import { useAccessoryStore } from '@/modules/accessories/store/accessoryStore'
import { Button } from '@/components/base/Button'
import { usePermissions } from '@/modules/settings/hooks/usePermissions'
import { theme } from '@/constants/theme'
import type { AccessoryInspection } from 'vescape-core'

export function AccessoryScanScreen({
  onOpenAccessory,
}: {
  onOpenAccessory: (accessoryId: string) => void
}) {
  const { status, request } = usePermissions()
  const {
    devices,
    scanning,
    scanError,
    inspecting,
    startScan,
    stopScan,
    inspect,
    cancelInspection,
  } = useAccessoryDiscoveryStore(
    useShallow((s) => ({
      devices: s.devices,
      scanning: s.scanning,
      scanError: s.scanError,
      inspecting: s.inspecting,
      startScan: s.startScan,
      stopScan: s.stopScan,
      inspect: s.inspect,
      cancelInspection: s.cancelInspection,
    })),
  )
  const enroll = useAccessoryStore((s) => s.enroll)
  const enrolling = useAccessoryStore((s) => s.enrolling)
  const [result, setResult] = useState<AccessoryInspection | null>(null)
  const [enrollError, setEnrollError] = useState<string | null>(null)
  const live = useRef(true)

  useEffect(() => {
    void request()
  }, [request])

  useEffect(() => {
    live.current = true
    if (status === 'granted') startScan()
    return () => {
      live.current = false
      stopScan()
      cancelInspection()
    }
  }, [status, startScan, stopScan, cancelInspection])

  const onSelect = useCallback(
    async (deviceId: string) => {
      setResult(null)
      setEnrollError(null)
      const inspection = await inspect(deviceId)
      if (!live.current) return
      setResult(inspection)
    },
    [inspect],
  )

  const onAdd = useCallback(
    async (deviceId: string) => {
      setEnrollError(null)
      const enrollment = await enroll(deviceId)
      if (!live.current) return
      if (enrollment.accessoryId) {
        onOpenAccessory(enrollment.accessoryId)
        return
      }
      setEnrollError(enrollment.error ?? 'connect-failed')
    },
    [enroll, onOpenAccessory],
  )

  const subtitle =
    status === 'denied'
      ? 'Bluetooth permission required'
      : scanError === 'bluetooth-unavailable'
        ? 'Bluetooth is off or unavailable'
        : scanError === 'scan-failed'
          ? 'The scan could not start'
          : enrolling
            ? 'Adding the accessory…'
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
            onPress={() => {
              if (!inspecting && !enrolling) void onSelect(item.id)
            }}
          />
        )}
        ListHeaderComponent={
          <View style={styles.header}>
            <IconHero
              icon={AccessoryIcon}
              description="Accessories are found by the service they advertise, not by their name."
            />
            <View style={styles.statusLine}>
              {(scanning || inspecting || enrolling) && (
                <ActivityIndicator color={theme.palette.sky.color} size="small" />
              )}
              <Text style={styles.subtitle}>{subtitle}</Text>
            </View>
            {result && !result.manifest && result.error ? (
              <Text style={styles.error}>
                {result.advertisedName ?? result.deviceId}: {inspectionErrorCopy(result.error)}
              </Text>
            ) : null}
            {enrollError ? (
              <Text style={styles.error}>{inspectionErrorCopy(enrollError)}</Text>
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
                <Button
                  label={`Add ${result.manifest.name}`}
                  onPress={() => onAdd(result.deviceId)}
                  loading={enrolling === result.deviceId}
                  disabled={enrolling !== null}
                  testID="accessory-add"
                />
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
