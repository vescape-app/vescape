import type { GpsPhase, LocationEvent } from 'vescape-core'

/**
 * A fix older than this is treated as lost rather than current — the same window native uses to
 * report `gps_fix_stale`, so the badge and the diagnostic log agree on when GPS went quiet.
 *
 * @parity /modules/vescape-core/ios/location/GpsPrecision.swift `GPS_STALE_FIX_TIMEOUT_S`
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/location/GpsPrecision.kt `GPS_STALE_FIX_TIMEOUT_MS`
 */
export const GPS_STALE_FIX_TIMEOUT_MS = 30_000

export interface GpsStatusBadge {
  /** Stable identity for the state, so a showcase and tests can name one without matching copy. */
  kind: 'off' | 'starting' | 'blocked' | 'searching' | 'lost' | 'weak'
  label: string
}

/**
 * What is wrong with GPS right now, or `null` when nothing is — the badge only exists to explain a
 * missing or untrustworthy position, so a healthy receiver shows nothing at all.
 *
 * Phase comes from native (issue #445) and is never inferred here; freshness and precision are read
 * off the latest fix, which is the only part JS can see.
 */
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
  // A fix from the future is a clock skew, not a stale fix; clamp rather than cry "lost".
  if (nowMs - latestFix.timestamp >= GPS_STALE_FIX_TIMEOUT_MS) {
    return { kind: 'lost', label: 'GPS signal lost' }
  }
  if (!latestFix.precise) return { kind: 'weak', label: 'Weak GPS' }

  return null
}
