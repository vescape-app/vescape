import type { RideHistorySession } from 'vescape-core'

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/ProfileStatsRepository.kt `DEFAULT_RIDE_SPLIT_GAP_MINUTES`
 * @parity /modules/vescape-core/ios/telemetry/ProfileStatsRepository.swift `DEFAULT_RIDE_SPLIT_GAP_MINUTES`
 */
export const DEFAULT_RIDE_SPLIT_GAP_MINUTES = 30

export const LIVE_RIDE_MAX_AGE_MS = 3 * 60_000

export const RIDE_TRIM_PADDING_MS = 5_000

export type HistorySession = RideHistorySession

export function rideMovingWindow(
  session: Pick<HistorySession, 'movingStartAtMs' | 'movingEndAtMs'>,
): { startMs: number; endMs: number } | null {
  if (session.movingStartAtMs == null || session.movingEndAtMs == null) return null
  return { startMs: session.movingStartAtMs, endMs: session.movingEndAtMs }
}

export function rideDurationMs(
  session: Pick<HistorySession, 'movingStartAtMs' | 'movingEndAtMs' | 'startAtMs' | 'endAtMs'>,
): number {
  const window = rideMovingWindow(session)
  return window ? window.endMs - window.startMs : session.endAtMs - session.startAtMs
}

export function isLiveRide(session: Pick<HistorySession, 'endAtMs'>, nowMs: number): boolean {
  return nowMs - session.endAtMs <= LIVE_RIDE_MAX_AGE_MS
}

export function matchRideSession(
  sessions: HistorySession[],
  selected: HistorySession,
): HistorySession | null {
  return (
    sessions.find(
      (session) =>
        session.id === selected.id ||
        (session.boardId === selected.boardId &&
          session.startAtMs <= selected.endAtMs &&
          session.endAtMs >= selected.startAtMs),
    ) ?? null
  )
}
