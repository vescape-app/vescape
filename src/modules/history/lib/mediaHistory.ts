import type { HistoryGpsSample, HistoryMarker, TelemetrySample } from 'vescape-core'

import { findNearestSampleIndexByTime } from '@/modules/history/lib/playback'

const MEDIA_GPS_TOLERANCE_MS = 30_000
// Longest hole between two *route-quality* fixes that still counts as one continuous span. Native
// filters the Ride Track to the shared 20m precision rule before it crosses the bridge (ADR 0038),
// so this measures a gap in usable fixes, not a gap in GPS reception: a stretch where fixes kept
// arriving at worse accuracy reads as a hole here, and media inside it stays unmatched.
const MEDIA_PRECISE_GPS_SPAN_GAP_MS = 30_000
export const MEDIA_CLUSTER_DISTANCE_M = 12
const MEDIA_TELEMETRY_TOLERANCE_MS = 5_000
const MEDIA_TELEMETRY_SPAN_GAP_MS = 10_000

const SPAN_BREAK_MARKERS = new Set<HistoryMarker['type']>([
  'gap',
  'disconnected',
  'app_stop',
  'error',
])

export interface MediaAssetInput {
  id: string
  uri: string
  filename: string
  mediaType: 'photo' | 'video'
  creationTime: number
}

export interface MediaHistoryAsset extends MediaAssetInput {
  gps: HistoryGpsSample
}

export interface MediaHistoryCluster {
  id: string
  coordinate: [number, number]
  assets: MediaHistoryAsset[]
}

// EXIF DateTime* values: "YYYY:MM:DD HH:MM:SS", local time without timezone.
const EXIF_DATE_RE = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/
// Camera filenames: VID_20240101_123456, PXL_20240101_123456789, 20240101_123456, IMG-20240101-WA…
const FILENAME_DATE_RE = /(20\d{2})(\d{2})(\d{2})[_-](\d{2})(\d{2})(\d{2})/

function toEpochMs(
  [year, month, day, hour, minute, second]: number[],
  utc: boolean,
): number | null {
  const ms = utc
    ? Date.UTC(year, month - 1, day, hour, minute, second)
    : new Date(year, month - 1, day, hour, minute, second).getTime()
  return Number.isFinite(ms) ? ms : null
}

// The system photo picker exposes no asset creation time, so recover it from EXIF (photos)
// or camera filename conventions (videos). Returns null when neither source yields a date.
export function resolvePickedAssetCreationTime({
  exif,
  filename,
}: {
  exif?: Record<string, unknown> | null
  filename: string
}): number | null {
  for (const key of ['DateTimeOriginal', 'DateTimeDigitized', 'DateTime']) {
    const value = exif?.[key]
    const match = typeof value === 'string' ? EXIF_DATE_RE.exec(value) : null
    if (match) return toEpochMs(match.slice(1).map(Number), false)
  }
  const match = FILENAME_DATE_RE.exec(filename)
  if (!match) return null
  // Pixel camera filenames (PXL_*) encode UTC; other conventions use local time.
  return toEpochMs(match.slice(1).map(Number), filename.startsWith('PXL_'))
}

function hasBreakBetween(markers: readonly HistoryMarker[], fromMs: number, toMs: number) {
  return markers.some(
    (marker) =>
      SPAN_BREAK_MARKERS.has(marker.type) &&
      marker.occurredAtMs > Math.min(fromMs, toMs) &&
      marker.occurredAtMs <= Math.max(fromMs, toMs),
  )
}

/**
 * Is `targetMs` inside the same continuous run of route-quality fixes as `samples[index]`? Span
 * continuity is measured over the precision-filtered stream, so a run of imprecise fixes breaks a
 * span exactly like a reception gap does — see [MEDIA_PRECISE_GPS_SPAN_GAP_MS].
 */
function belongsToGpsSpan(
  samples: readonly HistoryGpsSample[],
  index: number,
  targetMs: number,
  markers: readonly HistoryMarker[],
) {
  const sample = samples[index]
  if (!sample || targetMs === sample.capturedAtMs) return !!sample
  const adjacentIndex = targetMs < sample.capturedAtMs ? index - 1 : index + 1
  const adjacent = samples[adjacentIndex]
  if (!adjacent) return false
  if (Math.abs(adjacent.capturedAtMs - sample.capturedAtMs) > MEDIA_PRECISE_GPS_SPAN_GAP_MS)
    return false
  return !hasBreakBetween(markers, adjacent.capturedAtMs, sample.capturedAtMs)
}

export function matchMediaHistoryAssets({
  assets,
  gpsSamples,
  markers,
  startAtMs,
  endAtMs,
}: {
  assets: readonly MediaAssetInput[]
  gpsSamples: readonly HistoryGpsSample[]
  markers: readonly HistoryMarker[]
  startAtMs: number
  endAtMs: number
}): MediaHistoryAsset[] {
  const matched: MediaHistoryAsset[] = []
  for (const asset of [...assets].sort(
    (a, b) => a.creationTime - b.creationTime || a.id.localeCompare(b.id),
  )) {
    if (
      !Number.isFinite(asset.creationTime) ||
      asset.creationTime < startAtMs ||
      asset.creationTime > endAtMs
    ) {
      continue
    }
    const index = findNearestSampleIndexByTime(gpsSamples, asset.creationTime)
    const gps = index >= 0 ? gpsSamples[index] : null
    if (!gps) continue
    if (Math.abs(gps.capturedAtMs - asset.creationTime) > MEDIA_GPS_TOLERANCE_MS) continue
    if (!belongsToGpsSpan(gpsSamples, index, asset.creationTime, markers)) continue
    matched.push({ ...asset, gps })
  }
  return matched
}

function distanceMeters(a: HistoryGpsSample, b: HistoryGpsSample) {
  const latScale = 111_320
  const lonScale = Math.cos((((a.latitude + b.latitude) / 2) * Math.PI) / 180) * latScale
  return Math.hypot((a.latitude - b.latitude) * latScale, (a.longitude - b.longitude) * lonScale)
}

export function clusterMediaHistoryAssets(
  assets: readonly MediaHistoryAsset[],
  maxDistanceM = MEDIA_CLUSTER_DISTANCE_M,
): MediaHistoryCluster[] {
  const clusters: MediaHistoryCluster[] = []
  for (const asset of [...assets].sort(
    (a, b) => a.creationTime - b.creationTime || a.id.localeCompare(b.id),
  )) {
    const cluster = clusters.find((candidate) =>
      candidate.assets.some((member) => distanceMeters(member.gps, asset.gps) <= maxDistanceM),
    )
    if (cluster) {
      cluster.assets.push(asset)
      continue
    }
    clusters.push({
      id: asset.id,
      coordinate: [asset.gps.longitude, asset.gps.latitude],
      assets: [asset],
    })
  }
  return clusters
}

export function findVideoTelemetrySample(
  samples: readonly TelemetrySample[],
  markers: readonly HistoryMarker[],
  videoStartMs: number,
  playbackSeconds: number,
): TelemetrySample | null {
  const targetMs = videoStartMs + playbackSeconds * 1_000
  if (
    samples.length === 0 ||
    targetMs < samples[0].capturedAtMs ||
    targetMs > samples[samples.length - 1].capturedAtMs
  ) {
    return null
  }
  const index = findNearestSampleIndexByTime(samples, targetMs)
  const sample = index >= 0 ? samples[index] : null
  if (!sample || Math.abs(sample.capturedAtMs - targetMs) > MEDIA_TELEMETRY_TOLERANCE_MS)
    return null
  if (hasBreakBetween(markers, sample.capturedAtMs, targetMs)) return null
  const before = samples[index - 1]
  const after = samples[index + 1]
  const otherSide = targetMs < sample.capturedAtMs ? before : after
  if (
    targetMs !== sample.capturedAtMs &&
    (!otherSide ||
      Math.abs(otherSide.capturedAtMs - sample.capturedAtMs) > MEDIA_TELEMETRY_SPAN_GAP_MS)
  ) {
    return null
  }
  if (
    before &&
    targetMs >= before.capturedAtMs &&
    hasBreakBetween(markers, before.capturedAtMs, sample.capturedAtMs)
  ) {
    return null
  }
  if (
    after &&
    targetMs <= after.capturedAtMs &&
    hasBreakBetween(markers, sample.capturedAtMs, after.capturedAtMs)
  ) {
    return null
  }
  return sample
}
