import * as Sentry from '@sentry/react-native'
import type { BoardConfigValues } from 'vescape-core'

import type { TuneCompatibilityIssue } from '@/modules/tune/lib/tuneCompatibility'

export function reportTuneCompatibilityIssue(
  issue: TuneCompatibilityIssue,
  boardConfig: BoardConfigValues,
  details?: { fwVersion?: string | null; refloatVersion?: string | null },
) {
  Sentry.captureMessage('Tune compatibility unavailable', {
    level: 'warning',
    tags: {
      feature: 'tune',
      reason: issue.reason,
    },
    extra: {
      firmwareVersion: details?.fwVersion ?? null,
      refloatVersion: details?.refloatVersion ?? boardConfig.refloatBaseVersion ?? null,
      schemaHash: boardConfig.schemaHash ?? null,
    },
  })
}
