import type { BoardConfigValues } from 'vescape-core'

export interface TuneCompatibilityIssue {
  message: string
  reason: 'missing-version' | 'unsupported-version'
}

export function getTuneCompatibilityIssue(
  boardConfig: BoardConfigValues | null,
  compatibility: string | null,
  reportedRefloatVersion?: string | null,
): TuneCompatibilityIssue | null {
  if (!boardConfig || compatibility) return null

  const reportedVersion = reportedRefloatVersion?.trim()
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

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TuneAlertPersistence.kt `tuneCompatibilityVersion`
 * @parity /modules/vescape-core/ios/telemetry/TuneProfileStore.swift `validRefloatBaseVersion`
 */
export function tuneCompatibilityVersion(value: string | null | undefined): string | null {
  return value?.match(/^(\d+\.\d+)(?:\.\d+)?(?:[-+].*)?$/)?.[1] ?? null
}
