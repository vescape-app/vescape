import type { RefloatConfigSnapshot } from 'vescape-core'

export type TuneCompatibilityIssue = {
  message: string
  reason: 'missing-version' | 'unsupported-version'
}

export function getTuneCompatibilityIssue(
  snapshot: RefloatConfigSnapshot | null,
  compatibility: string | null,
): TuneCompatibilityIssue | null {
  if (!snapshot || compatibility) return null

  const reportedVersion = snapshot.refloatVersion?.trim()
  if (reportedVersion) {
    return {
      reason: 'unsupported-version',
      message: `Tune Profiles are unavailable because this app does not recognize the board's Refloat version: ${reportedVersion}. Update the app or retry after reconnecting the board.`,
    }
  }

  return {
    reason: 'missing-version',
    message:
      'Tune Profiles are unavailable because the board did not report a recognizable Refloat version. Retry after reconnecting the board.',
  }
}
