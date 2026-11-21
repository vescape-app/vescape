import { Paths } from 'expo-file-system'
import { Platform } from 'react-native'

import { applicationId } from '@/config/appVariant'

export const fixtureReplayName = process.env.EXPO_PUBLIC_FIXTURE_REPLAY ?? ''

export const fixtureDatabaseFile = process.env.EXPO_PUBLIC_FIXTURE_DB ?? ''

/**
 * @parity /scripts/lib/androidCapture.ts
 * @parity /scripts/lib/iosCapture.ts
 */
export const fixtureDir =
  Platform.OS === 'ios'
    ? Paths.document.uri.replace(/\/$/, '')
    : `/storage/emulated/0/Android/data/${applicationId}/files`

export function fixtureUri(name: string): string {
  const base = fixtureDir
  return base.startsWith('file://') ? `${base}/${name}` : `file://${base}/${name}`
}
