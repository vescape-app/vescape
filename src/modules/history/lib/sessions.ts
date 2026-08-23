import type { RideHistorySession } from 'vescape-core'

/**
 * Minutes without a recorded sample that end a Ride when the rider has not changed the setting.
 * Native receives the current setting at read time and owns all grouping.
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/ProfileStatsRepository.kt `DEFAULT_RIDE_SPLIT_GAP_MINUTES`
 * @parity /modules/vescape-core/ios/telemetry/ProfileStatsRepository.swift `DEFAULT_RIDE_SPLIT_GAP_MINUTES`
 */
export const DEFAULT_RIDE_SPLIT_GAP_MINUTES = 30

/** Display breathing room kept on each side of the Moving Window. */
export const RIDE_TRIM_PADDING_MS = 5_000

export type HistorySession = RideHistorySession

/** First→last moving sample, or null for legacy data without a precomputed Moving Window. */
export function rideMovingWindow(
  session: Pick<HistorySession, 'movingStartAtMs' | 'movingEndAtMs'>,
): { startMs: number; endMs: number } | null {
  if (session.movingStartAtMs == null || session.movingEndAtMs == null) return null
  return { startMs: session.movingStartAtMs, endMs: session.movingEndAtMs }
}

/** Riding span shown as Ride Time; legacy data falls back to its wall-clock span. */
export function rideDurationMs(
  session: Pick<HistorySession, 'movingStartAtMs' | 'movingEndAtMs' | 'startAtMs' | 'endAtMs'>,
): number {
  const window = rideMovingWindow(session)
  return window ? window.endMs - window.startMs : session.endAtMs - session.startAtMs
}
