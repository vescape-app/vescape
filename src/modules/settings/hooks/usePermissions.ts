import { useCallback, useState } from 'react'
import type { Permission } from 'react-native'
import { PermissionsAndroid, Platform } from 'react-native'

export type PermissionStatus = 'unknown' | 'granted' | 'denied'

export async function hasBackgroundLocation(): Promise<boolean> {
  if (Platform.OS !== 'android' || Platform.Version < 29) return true
  try {
    return await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.ACCESS_BACKGROUND_LOCATION)
  } catch {
    return false
  }
}

export async function ensureBackgroundLocation(): Promise<boolean> {
  if (await hasBackgroundLocation()) return true
  try {
    const result = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.ACCESS_BACKGROUND_LOCATION,
    )
    return result === PermissionsAndroid.RESULTS.GRANTED
  } catch {
    return false
  }
}

export function usePermissions(): {
  status: PermissionStatus
  request: () => Promise<void>
} {
  const [status, setStatus] = useState<PermissionStatus>('unknown')

  const request = useCallback(async () => {
    if (Platform.OS !== 'android') {
      setStatus('granted')
      return
    }

    try {
      const permissions: Permission[] = [
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      ]

      if (Platform.Version >= 33) {
        permissions.push(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS)
      }

      const results = await PermissionsAndroid.requestMultiple(permissions)

      const allGranted = Object.values(results).every(
        (r) => r === PermissionsAndroid.RESULTS.GRANTED,
      )
      setStatus(allGranted ? 'granted' : 'denied')
    } catch {
      setStatus('denied')
    }
  }, [])

  return { status, request }
}
