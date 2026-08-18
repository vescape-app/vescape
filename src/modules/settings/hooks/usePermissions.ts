import { useCallback, useState } from 'react'
import type { Permission } from 'react-native'
import { PermissionsAndroid, Platform } from 'react-native'

export type PermissionStatus = 'unknown' | 'granted' | 'denied'

/**
 * ACCESS_BACKGROUND_LOCATION ("Allow all the time") is required for the companion auto-start path:
 * the OS starts the foreground service from the background and withholds while-in-use location from
 * a background-started FGS, so hands-off rides record no GPS unless background access is granted.
 *
 * Returns true on iOS / pre-Q, where the permission does not exist as a separate grant.
 */
export async function hasBackgroundLocation(): Promise<boolean> {
  if (Platform.OS !== 'android' || Platform.Version < 29) return true
  try {
    return await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.ACCESS_BACKGROUND_LOCATION)
  } catch {
    return false
  }
}

/**
 * Try to obtain background location. On Android 10 (API 29) the system still shows an inline dialog
 * with "Allow all the time"; on Android 11+ (API 30+) Google removed that dialog, so request() returns
 * denied without UI and the user must flip it manually in Settings — callers handle that by routing to
 * Settings after a rationale. Must run as its own step, after ACCESS_FINE_LOCATION is already granted.
 */
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

/**
 * Request BLE and notification runtime permissions on Android 12+ (API 31+).
 * On iOS the app relies on static Info.plist usage descriptions, so no
 * runtime permission request is needed here.
 */
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
        // ACCESS_FINE_LOCATION is required for BLE scanning on API < 31
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
