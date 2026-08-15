import type { LocationEvent } from 'vescape-core'

import { distanceMeters } from './mapGeometry'

const LIVE_GPS_DEGRADED_GRACE_MS = 2_000

interface LiveGpsPresentationArgs {
  preciseFix: LocationEvent | null
  latestApproximateFix: LocationEvent | null
  initialApproximateFix: LocationEvent | null
  degradedGraceMs?: number
}

export interface LiveGpsPresentation {
  cameraFix: LocationEvent | null
  accuracyFix: LocationEvent | null
  accuracyRadiusM: number | null
  directionBearingDeg: number | null
  directionBearingSourceTimestamp: number | null
  nextInitialApproximateFix: LocationEvent | null
  degraded: boolean
}

export function getLiveGpsPresentation({
  preciseFix,
  latestApproximateFix,
  initialApproximateFix,
  degradedGraceMs = LIVE_GPS_DEGRADED_GRACE_MS,
}: LiveGpsPresentationArgs): LiveGpsPresentation {
  const nextInitialApproximateFix = getNextInitialApproximateFix({
    preciseFix,
    latestApproximateFix,
    initialApproximateFix,
  })
  const degradedAccuracyRadiusM = getDegradedAccuracyRadiusM({
    preciseFix,
    latestApproximateFix,
    degradedGraceMs,
  })
  const cameraFix = preciseFix ?? nextInitialApproximateFix
  const accuracyFix = degradedAccuracyRadiusM != null ? preciseFix : cameraFix

  return {
    cameraFix,
    accuracyFix,
    accuracyRadiusM: degradedAccuracyRadiusM ?? accuracyFix?.accuracyM ?? null,
    // Native derives the reliable course per fix and retains it across stops; JS only passes it on.
    directionBearingDeg: preciseFix?.courseDeg ?? null,
    directionBearingSourceTimestamp: preciseFix?.courseSourceTimestamp ?? null,
    nextInitialApproximateFix,
    degraded: degradedAccuracyRadiusM != null,
  }
}

function getNextInitialApproximateFix({
  preciseFix,
  latestApproximateFix,
  initialApproximateFix,
}: Pick<
  LiveGpsPresentationArgs,
  'preciseFix' | 'latestApproximateFix' | 'initialApproximateFix'
>): LocationEvent | null {
  if (preciseFix || !latestApproximateFix) return null
  return initialApproximateFix ?? latestApproximateFix
}

function getDegradedAccuracyRadiusM({
  preciseFix,
  latestApproximateFix,
  degradedGraceMs,
}: Pick<LiveGpsPresentationArgs, 'preciseFix' | 'latestApproximateFix'> & {
  degradedGraceMs: number
}): number | null {
  if (!preciseFix || !latestApproximateFix || latestApproximateFix.precise) return null
  if (latestApproximateFix.timestamp - preciseFix.timestamp <= degradedGraceMs) return null

  return distanceMeters(preciseFix, latestApproximateFix) + (latestApproximateFix.accuracyM ?? 0)
}
