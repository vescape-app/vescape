import type { Favorite, TelemetryMinuteBucket } from 'vescape-core'

import { rideMovingWindow, type HistorySession } from '@/modules/history/lib/sessions'

/** The canonical full-ride range. Legacy rides fall back from Moving Window to wall-clock span. */
export function favoriteRangeForSession(
  session: Pick<HistorySession, 'movingStartAtMs' | 'movingEndAtMs' | 'startAtMs' | 'endAtMs'>,
): { startMs: number; endMs: number } {
  const window = rideMovingWindow(session)
  return window ?? { startMs: session.startAtMs, endMs: session.endAtMs }
}

/**
 * Seed trim handles visibly inside the ride so their draggable direction is obvious.
 *
 * When the chart is zoomed, seed inside the visible window instead of the whole ride: handles
 * seeded off-screen read as a broken control, and a zoom is the rider pointing at the stretch
 * they mean to keep.
 */
export function initialFavoriteTrimRangeForSession(
  session: Pick<HistorySession, 'movingStartAtMs' | 'movingEndAtMs' | 'startAtMs' | 'endAtMs'>,
  visible?: { startMs: number; endMs: number } | null,
): { startMs: number; endMs: number } {
  const ride = favoriteRangeForSession(session)
  const startMs = visible
    ? Math.max(ride.startMs, Math.min(visible.startMs, ride.endMs))
    : ride.startMs
  const endMs = visible ? Math.min(ride.endMs, Math.max(visible.endMs, ride.startMs)) : ride.endMs
  const range = endMs > startMs ? { startMs, endMs } : ride
  const inset = (range.endMs - range.startMs) * 0.15
  return { startMs: range.startMs + inset, endMs: range.endMs - inset }
}

/**
 * The Favorite already covering this ride's Moving Window, so the star reads as filled. Matched on
 * the range alone: only one Board Session records at a time, so a range never spans two boards, and
 * a Favorite stores a Board id rather than the ble id a history session carries.
 */
export function findSessionFavorite(
  favorites: Favorite[],
  session: Pick<HistorySession, 'movingStartAtMs' | 'movingEndAtMs' | 'startAtMs' | 'endAtMs'>,
): Favorite | null {
  const range = favoriteRangeForSession(session)
  return (
    favorites.find(
      (favorite) => favorite.startMs === range.startMs && favorite.endMs === range.endMs,
    ) ?? null
  )
}

/**
 * A Favorite seen as a ride, so opening one reuses the whole history detail path — range load,
 * chart, map route and stats bar — instead of a parallel implementation.
 *
 * The pinned summary wins over anything derivable from buckets: it was computed from raw samples at
 * creation and is exact for a range that cuts a bucket in half. Only what the row cannot carry
 * (geography, the buckets to read, the recording device) is derived from the overlapping buckets.
 * Favorite identity stays separate from the recording device so each can be presented consistently.
 */
export function favoriteToSession(
  favorite: Favorite,
  blocks: TelemetryMinuteBucket[],
): HistorySession {
  const spanned = blocks
    .filter((block) => block.startAtMs <= favorite.endMs && block.endAtMs >= favorite.startMs)
    .sort((a, b) => a.startAtMs - b.startAtMs)
  const latitudes = spanned.map((block) => block.firstLatitude).filter(isFinitePoint)
  const longitudes = spanned.map((block) => block.firstLongitude).filter(isFinitePoint)
  return {
    id: favoriteSessionId(favorite.id),
    boardId: spanned.find((block) => block.boardId != null)?.boardId ?? null,
    boardName: favorite.boardName ?? spanned[0]?.boardName ?? '',
    startAtMs: favorite.startMs,
    endAtMs: favorite.endMs,
    // A Favorite is already a trimmed span: it is its own Moving Window, so the chart and the title
    // cover exactly what was pinned.
    movingStartAtMs: favorite.startMs,
    movingEndAtMs: favorite.endMs,
    blockIds: spanned.map((block) => block.id),
    blockCount: spanned.length,
    sampleCount: favorite.sampleCount,
    gpsPointCount: favorite.gpsPointCount,
    preciseGpsPointCount: sum(spanned.map((block) => block.preciseGpsPointCount)),
    distanceM: favorite.distanceM,
    maxSpeedKmh: favorite.maxSpeedKmh,
    avgSpeedKmh: favorite.avgSpeedKmh,
    maxTempMosfet: maxOrNull(spanned.map((block) => block.maxTempMosfet)),
    maxTempMotor: maxOrNull(spanned.map((block) => block.maxTempMotor)),
    maxDuty: Math.max(0, ...spanned.map((block) => block.maxDuty)),
    batteryUsedWh: favorite.batteryUsedWh,
    batteryRegenWh: sum(spanned.map((block) => block.batteryRegenWh)),
    firstLatitude: latitudes[0] ?? null,
    firstLongitude: longitudes[0] ?? null,
    centerLatitude: average(latitudes),
    centerLongitude: average(longitudes),
    minLatitude: minOrNull(latitudes),
    maxLatitude: maxOrNull(latitudes),
    minLongitude: minOrNull(longitudes),
    maxLongitude: maxOrNull(longitudes),
    faultCount: sum(spanned.map((block) => block.faultCount)),
    boundaryBefore: 'none',
  }
}

/** Namespaced so a favorite-backed session never collides with a grouped history session id. */
export function favoriteSessionId(favoriteId: string): string {
  return `favorite:${favoriteId}`
}

function isFinitePoint(value: number | null): value is number {
  return value != null && Number.isFinite(value)
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0)
}

function average(values: number[]): number | null {
  return values.length > 0 ? sum(values) / values.length : null
}

function minOrNull(values: (number | null)[]): number | null {
  const finite = values.filter(isFinitePoint)
  return finite.length > 0 ? Math.min(...finite) : null
}

function maxOrNull(values: (number | null)[]): number | null {
  const finite = values.filter(isFinitePoint)
  return finite.length > 0 ? Math.max(...finite) : null
}

/** Any overlap means deleting this history session must leave a protected telemetry island. */
export function sessionContainsFavorite(
  favorites: Favorite[],
  session: Pick<HistorySession, 'startAtMs' | 'endAtMs'>,
): boolean {
  return favorites.some(
    (favorite) => favorite.startMs <= session.endAtMs && favorite.endMs >= session.startAtMs,
  )
}
