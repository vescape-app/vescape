import type { AppSettings } from 'vescape-core'
import type { ResolvedTheme } from '@/constants/theme'

export type ThemeMode = AppSettings['themeMode']
export type { ResolvedTheme } from '@/constants/theme'

export interface ThemeCoordinate {
  latitude: number
  longitude: number
}

const DEG_TO_RAD = Math.PI / 180
const RAD_TO_DEG = 180 / Math.PI
const SUNRISE_ELEVATION_DEGREES = -0.833
const FULL_NIGHT_ELEVATION_DEGREES = -12
const FULL_DAYLIGHT_ELEVATION_DEGREES = 6

function normalizeDegrees(value: number): number {
  return ((value % 360) + 360) % 360
}

function signedDegrees(value: number): number {
  const normalized = normalizeDegrees(value)
  return normalized > 180 ? normalized - 360 : normalized
}

export function isUsableThemeCoordinate(
  coordinate: ThemeCoordinate | null | undefined,
): coordinate is ThemeCoordinate {
  return (
    coordinate != null &&
    Number.isFinite(coordinate.latitude) &&
    Number.isFinite(coordinate.longitude) &&
    Math.abs(coordinate.latitude) <= 90 &&
    Math.abs(coordinate.longitude) <= 180
  )
}

/** NOAA-style solar position calculation. Longitude is positive east of Greenwich. */
export function solarElevationDegrees(date: Date, coordinate: ThemeCoordinate): number {
  const julianDay = date.getTime() / 86_400_000 + 2_440_587.5
  const daysSinceJ2000 = julianDay - 2_451_545
  const meanLongitude = normalizeDegrees(280.46 + 0.9856474 * daysSinceJ2000)
  const meanAnomaly = normalizeDegrees(357.528 + 0.9856003 * daysSinceJ2000) * DEG_TO_RAD
  const eclipticLongitude =
    (meanLongitude + 1.915 * Math.sin(meanAnomaly) + 0.02 * Math.sin(2 * meanAnomaly)) * DEG_TO_RAD
  const obliquity = (23.439 - 0.0000004 * daysSinceJ2000) * DEG_TO_RAD
  const rightAscension =
    Math.atan2(Math.cos(obliquity) * Math.sin(eclipticLongitude), Math.cos(eclipticLongitude)) *
    RAD_TO_DEG
  const declination = Math.asin(Math.sin(obliquity) * Math.sin(eclipticLongitude))
  const siderealTime = normalizeDegrees(
    280.46061837 + 360.98564736629 * daysSinceJ2000 + coordinate.longitude,
  )
  const hourAngle = signedDegrees(siderealTime - rightAscension) * DEG_TO_RAD
  const latitude = coordinate.latitude * DEG_TO_RAD
  const elevation = Math.asin(
    Math.sin(latitude) * Math.sin(declination) +
      Math.cos(latitude) * Math.cos(declination) * Math.cos(hourAngle),
  )
  return elevation * RAD_TO_DEG
}

export function outdoorLightProgress(date: Date, coordinate: ThemeCoordinate): number {
  const elevation = solarElevationDegrees(date, coordinate)
  const linear = Math.min(
    1,
    Math.max(
      0,
      (elevation - FULL_NIGHT_ELEVATION_DEGREES) /
        (FULL_DAYLIGHT_ELEVATION_DEGREES - FULL_NIGHT_ELEVATION_DEGREES),
    ),
  )
  return linear * linear * (3 - 2 * linear)
}

export function resolveThemeMode({
  mode,
  systemTheme,
  date,
  coordinate,
  sessionOverride,
}: {
  mode: ThemeMode
  systemTheme: ResolvedTheme | null | undefined
  date: Date
  coordinate?: ThemeCoordinate | null
  sessionOverride?: ResolvedTheme | null
}): ResolvedTheme {
  if (sessionOverride) return sessionOverride
  if (mode === 'light' || mode === 'dark') return mode
  if (mode === 'sun' && isUsableThemeCoordinate(coordinate)) {
    return solarElevationDegrees(date, coordinate) >= SUNRISE_ELEVATION_DEGREES ? 'light' : 'dark'
  }
  return systemTheme === 'light' ? 'light' : 'dark'
}
