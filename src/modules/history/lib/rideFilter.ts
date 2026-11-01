import type { RideHistoryFilter } from 'vescape-core'

export type RideDatePreset = 'thisMonth' | 'previousMonth' | 'last7Days' | 'custom'

/** Local-time `[fromMs, toMs)` a date preset or custom range resolved to. */
export interface RideDateRange {
  preset: RideDatePreset
  fromMs: number
  toMs: number
}

/** What the rider picked in the filter sheet; native only ever sees `toRideHistoryFilter`. */
export interface RideFilterSelection {
  date: RideDateRange | null
  boardIds: string[]
}

export const EMPTY_RIDE_FILTER: RideFilterSelection = { date: null, boardIds: [] }

function startOfDay(ms: number): Date {
  const date = new Date(ms)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

/** Presets end at the next local midnight, so today's rides are always in. */
export function presetRange(
  preset: Exclude<RideDatePreset, 'custom'>,
  nowMs: number,
): RideDateRange {
  const today = startOfDay(nowMs)
  const year = today.getFullYear()
  const month = today.getMonth()
  const tomorrow = new Date(year, month, today.getDate() + 1).getTime()
  switch (preset) {
    case 'thisMonth':
      return { preset, fromMs: new Date(year, month, 1).getTime(), toMs: tomorrow }
    case 'previousMonth':
      return {
        preset,
        fromMs: new Date(year, month - 1, 1).getTime(),
        toMs: new Date(year, month, 1).getTime(),
      }
    case 'last7Days':
      return {
        preset,
        fromMs: new Date(year, month, today.getDate() - 6).getTime(),
        toMs: tomorrow,
      }
  }
}

/** Whole local days from `fromDayMs` through `toDayMs`, in either order. */
export function customRange(fromDayMs: number, toDayMs: number): RideDateRange {
  const [first, last] = fromDayMs <= toDayMs ? [fromDayMs, toDayMs] : [toDayMs, fromDayMs]
  const end = startOfDay(last)
  return {
    preset: 'custom',
    fromMs: startOfDay(first).getTime(),
    toMs: new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1).getTime(),
  }
}

export function isRideFilterActive(selection: RideFilterSelection): boolean {
  return selection.date != null || selection.boardIds.length > 0
}

export function toRideHistoryFilter(selection: RideFilterSelection): RideHistoryFilter {
  return {
    ...(selection.date ? { fromMs: selection.date.fromMs, toMs: selection.date.toMs } : {}),
    ...(selection.boardIds.length > 0 ? { boardIds: selection.boardIds } : {}),
  }
}

/**
 * Favorites filter in JS: they are not paged natively, so they match by their ride's start and Board.
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/RideHistoryRepository.kt `RideHistoryFilter`
 * @parity /modules/vescape-core/ios/telemetry/RideHistoryRepository.swift `RideHistoryFilter`
 */
export function matchesRideFilter(
  ride: { startAtMs: number; boardId: string | null },
  filter: RideHistoryFilter,
): boolean {
  if (filter.fromMs != null && ride.startAtMs < filter.fromMs) return false
  if (filter.toMs != null && ride.startAtMs >= filter.toMs) return false
  if (filter.boardIds?.length && !filter.boardIds.includes(ride.boardId ?? '')) return false
  return true
}
