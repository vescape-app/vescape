import type { RideHistoryFilter, RideWeather, RideWeatherCondition } from 'vescape-core'

export type RideDatePreset = 'thisMonth' | 'previousMonth' | 'custom'

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
  weather: RideWeatherCondition[]
}

export const EMPTY_RIDE_FILTER: RideFilterSelection = { date: null, boardIds: [], weather: [] }

function startOfDay(ms: number): Date {
  const date = new Date(ms)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

/** This month ends at the next local midnight, so today's rides are always in. */
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
  return selection.date != null || selection.boardIds.length > 0 || selection.weather.length > 0
}

export function toRideHistoryFilter(selection: RideFilterSelection): RideHistoryFilter {
  return {
    ...(selection.date ? { fromMs: selection.date.fromMs, toMs: selection.date.toMs } : {}),
    ...(selection.boardIds.length > 0 ? { boardIds: selection.boardIds } : {}),
    ...(selection.weather.length > 0 ? { weather: selection.weather } : {}),
  }
}

/**
 * Native's weather match, repeated for favorites: they are all loaded, so JS filters them.
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/RideHistoryRepository.kt `RideWeatherCondition`
 * @parity /modules/vescape-core/ios/telemetry/RideHistoryRepository.swift `RideWeatherCondition`
 */
export const RIDE_WEATHER_THRESHOLDS = {
  rainMinMinutes: 5,
  coldMaxC: 5,
  hotMinC: 28,
  windyMinGustKmh: 40,
} as const

const WEATHER_GROUPS: Record<RideWeatherCondition, string> = {
  clear: 'sky',
  cloudy: 'sky',
  rain: 'sky',
  snow: 'sky',
  storm: 'sky',
  cold: 'temperature',
  hot: 'temperature',
  windy: 'wind',
  night: 'light',
}

const WEATHER_MATCHERS: Record<RideWeatherCondition, (weather: RideWeather) => boolean> = {
  clear: ({ icon }) => icon === 'sun' || icon === 'moon',
  cloudy: ({ icon }) => ['cloud-sun', 'cloud-moon', 'cloud', 'cloud-fog'].includes(icon),
  rain: (weather) => weather.rainMinutes >= RIDE_WEATHER_THRESHOLDS.rainMinMinutes,
  snow: ({ icon }) => icon === 'cloud-snow',
  storm: ({ icon }) => icon === 'cloud-lightning',
  cold: (weather) => weather.minTemperatureC <= RIDE_WEATHER_THRESHOLDS.coldMaxC,
  hot: (weather) => weather.maxTemperatureC >= RIDE_WEATHER_THRESHOLDS.hotMinC,
  windy: (weather) => (weather.maxGustKmh ?? 0) >= RIDE_WEATHER_THRESHOLDS.windyMinGustKmh,
  night: ({ icon }) => icon === 'moon' || icon === 'cloud-moon',
}

function matchesWeather(conditions: RideWeatherCondition[], weather: RideWeather): boolean {
  const groups = new Set(conditions.map((condition) => WEATHER_GROUPS[condition]))
  return [...groups].every((group) =>
    conditions.some(
      (condition) => WEATHER_GROUPS[condition] === group && WEATHER_MATCHERS[condition](weather),
    ),
  )
}

/**
 * Favorites filter in JS: they are not paged natively, so they match by their ride's start and Board.
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/RideHistoryRepository.kt `RideHistoryFilter`
 * @parity /modules/vescape-core/ios/telemetry/RideHistoryRepository.swift `RideHistoryFilter`
 */
export function matchesRideFilter(
  ride: { startAtMs: number; boardId: string | null; weather: RideWeather | null },
  filter: RideHistoryFilter,
): boolean {
  if (filter.fromMs != null && ride.startAtMs < filter.fromMs) return false
  if (filter.toMs != null && ride.startAtMs >= filter.toMs) return false
  if (filter.boardIds?.length && !filter.boardIds.includes(ride.boardId ?? '')) return false
  if (filter.weather?.length) {
    if (!ride.weather || !matchesWeather(filter.weather, ride.weather)) return false
  }
  return true
}
