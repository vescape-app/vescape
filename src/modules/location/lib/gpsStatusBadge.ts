import type { GpsPhase, LocationEvent } from 'vescape-core'

/**
 * @parity /modules/vescape-core/ios/location/GpsPrecision.swift `GPS_STALE_FIX_TIMEOUT_S`
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/location/GpsPrecision.kt `GPS_STALE_FIX_TIMEOUT_MS`
 */
export const GPS_STALE_FIX_TIMEOUT_MS = 30_000

export interface GpsStatusBadge {
  kind: 'off' | 'starting' | 'blocked' | 'searching' | 'lost' | 'weak'
  label: string
}

export function deriveGpsStatusBadge({
  phase,
  latestFix,
  nowMs,
}: {
  phase: GpsPhase
  latestFix: LocationEvent | null
  nowMs: number
}): GpsStatusBadge | null {
  if (phase === 'error') return { kind: 'blocked', label: 'GPS blocked' }
  if (phase === 'idle') return { kind: 'off', label: 'GPS off' }
  if (phase === 'starting') return { kind: 'starting', label: 'Starting GPS' }

  if (!latestFix) return { kind: 'searching', label: 'Searching for GPS' }
  if (nowMs - latestFix.timestamp >= GPS_STALE_FIX_TIMEOUT_MS) {
    return { kind: 'lost', label: 'GPS signal lost' }
  }
  if (!latestFix.precise) return { kind: 'weak', label: 'Weak GPS' }

  return null
}
