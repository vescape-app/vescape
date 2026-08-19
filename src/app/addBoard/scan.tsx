import { useEffect } from 'react'
import { View, FlatList, Pressable, ActivityIndicator, StyleSheet } from 'react-native'
import { Text } from '@/components/base/Text'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router, useLocalSearchParams } from 'expo-router'
import { useShallow } from 'zustand/react/shallow'

import { useBleStore } from '@/modules/board/store/bleStore'
import { usePermissions } from '@/modules/settings/hooks/usePermissions'
import { DeviceRow } from '@/components/base/DeviceRow'
import { routes } from '@/navigation/routes'
import type { ScannedDevice } from '@/modules/board/store/bleStore'
import { theme } from '@/constants/theme'

export default function AddBoardScanScreen() {
  const { boardId, step } = useLocalSearchParams<{ boardId?: string; step?: string }>()
  const { status, request } = usePermissions()
  const { devices, error, startScan, stopScan, isScanning } = useBleStore(
    useShallow((s) => ({
      devices: s.devices,
      error: s.error,
      startScan: s.startScan,
      stopScan: s.stopScan,
      isScanning: s.scanStatus === 'scanning',
    })),
  )

  useEffect(() => {
    void request()
  }, [request])

  useEffect(() => {
    if (status === 'granted') {
      startScan()
    }
    return () => stopScan()
  }, [status, startScan, stopScan])

  const handleSelect = (device: ScannedDevice) => {
    stopScan()
    if (boardId) {
      // Linking an existing board: probe the chosen peripheral, then save its link.
      router.push({
        pathname: routes.editBoardLink,
        params: { boardId, bleId: device.id, bleName: device.name },
      })
    } else {
      router.push({
        pathname: routes.addBoard,
        params: { step: step ?? '1', bleId: device.id, bleName: device.name },
      })
    }
  }

  const handleSkip = () => {
    stopScan()
    if (boardId) {
      router.push({ pathname: routes.editBoard, params: { boardId } })
      return
    }
    router.push({ pathname: routes.addBoard, params: { step: step ?? '1' } })
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <FlatList
        data={devices}
        keyExtractor={(d) => d.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <DeviceRow
            id={item.id}
            name={item.name}
            rssi={item.rssi}
            onPress={() => handleSelect(item)}
          />
        )}
        ListHeaderComponent={
          <View style={styles.header}>
            {isScanning && (
              <ActivityIndicator color={theme.palette.sky.color} style={styles.spinner} />
            )}
            <Text style={styles.subtitle}>
              {status === 'denied'
                ? 'Bluetooth permission required'
                : error
                  ? error
                  : isScanning
                    ? 'Scanning for nearby boards…'
                    : 'No boards found nearby'}
            </Text>
          </View>
        }
        ListEmptyComponent={
          !isScanning ? null : (
            <Text style={styles.empty}>Boards will appear here as they are found</Text>
          )
        }
      />

      <Pressable style={styles.skipButton} onPress={handleSkip}>
        <Text style={styles.skipText}>Skip pairing for now</Text>
      </Pressable>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.neutral.bg,
  },
  list: {
    padding: 16,
    flexGrow: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
  },
  spinner: {
    marginRight: 4,
  },
  subtitle: {
    color: theme.neutral.textSecondary,
    fontSize: 14,
  },
  empty: {
    color: theme.neutral.textDim,
    textAlign: 'center',
    marginTop: 40,
    fontSize: 14,
  },
  skipButton: {
    margin: 16,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: theme.neutral.border,
    borderRadius: 10,
  },
  skipText: {
    color: theme.neutral.textSecondary,
    fontSize: 15,
    fontWeight: '600',
  },
})
