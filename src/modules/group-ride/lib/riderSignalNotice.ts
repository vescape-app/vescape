import type { PublicRiderPins } from 'vescape-core'

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/RiderSignalNotices.kt `key`
 * @parity /modules/vescape-core/ios/groupride/RiderSignalNotices.swift `key`
 */
const KEY_PREFIX = 'riderSignal:'

export function riderSignalNoticeRider(
  key: string,
  pins: readonly PublicRiderPins[],
): PublicRiderPins | null {
  if (!key.startsWith(KEY_PREFIX)) return null
  const riderId = key.slice(KEY_PREFIX.length)
  return pins.find((pin) => pin.accountId === riderId && pin.signal) ?? null
}
