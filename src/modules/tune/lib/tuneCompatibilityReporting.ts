import * as Sentry from '@sentry/react-native'
import type { RefloatConfigSnapshot } from 'vescape-core'

import type { TuneCompatibilityIssue } from '@/modules/tune/lib/tuneCompatibility'

export function reportTuneCompatibilityIssue(
  issue: TuneCompatibilityIssue,
  snapshot: RefloatConfigSnapshot,
) {
  Sentry.captureMessage('Tune compatibility unavailable', {
    level: 'warning',
    tags: {
      feature: 'tune',
      reason: issue.reason,
    },
    extra: {
      firmwareVersion: snapshot.fwVersion,
      refloatVersion: snapshot.refloatVersion ?? null,
      canId: snapshot.canId,
      schemaHash: snapshot.schemaHash,
    },
  })
}
