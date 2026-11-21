import type { Favorite, TelemetryMinuteBucket } from 'vescape-core'

import { rideMovingWindow, type HistorySession } from '@/modules/history/lib/sessions'

export function favoriteRangeForSession(
  session: Pick<HistorySession, 'movingStartAtMs' | 'movingEndAtMs' | 'startAtMs' | 'endAtMs'>,
): { startMs: number; endMs: number } {
  const window = rideMovingWindow(session)
  return window ?? { startMs: session.startAtMs, endMs: session.endAtMs }
}

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

export function favoriteToSession(
  favorite: Favorite,
  blocks: TelemetryMinuteBucket[],
): HistorySession {
  const spanned = blocks
    .filter((block) => block.startAtMs <= favorite.endMs && block.endAtMs >= favorite.startMs)
    .sort((a, b) => a.startAtMs - b.startAtMs)
  const routePoints = favorite.routePoints
  const latitudes = routePoints.map((point) => point.latitude).filter(isFinitePoint)
  const longitudes = routePoints.map((point) => point.longitude).filter(isFinitePoint)
  return {
    id: favoriteSessionId(favorite.id),
    boardId: spanned.find((block) => block.boardId != null)?.boardId ?? null,
    boardName: favorite.boardName ?? spanned[0]?.boardName ?? '',
    startAtMs: favorite.startMs,
    endAtMs: favorite.endMs,
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
    boundaryBefore: 'none',
    routePoints,
    weather: favorite.weather,
  }
}

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

export function sessionContainsFavorite(
  favorites: Favorite[],
  session: Pick<HistorySession, 'startAtMs' | 'endAtMs'>,
): boolean {
  return favorites.some(
    (favorite) => favorite.startMs <= session.endAtMs && favorite.endMs >= session.startAtMs,
  )
}
