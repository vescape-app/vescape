import type { DistanceUnit, TemperatureUnit } from 'vescape-core'

export type { DistanceUnit, TemperatureUnit }

/**
 * Presentation conversions shared with native speech and companion displays.
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/UnitPresentation.kt
 * @parity /modules/vescape-core/ios/telemetry/UnitPresentation.swift
 */
export const METERS_PER_MILE = 1609.344
const FEET_PER_MILE = 5280

/** Board telemetry and persisted speed thresholds use km/h. */
export function speedFromKmh(kmh: number, distanceUnit: DistanceUnit): number {
  'worklet'
  return distanceUnit === 'mi' ? (kmh * 1000) / METERS_PER_MILE : kmh
}

/** GPS speed uses m/s. */
export function speedFromMps(mps: number, distanceUnit: DistanceUnit): number {
  'worklet'
  return speedFromKmh(mps * 3.6, distanceUnit)
}

export function speedToKmh(value: number, distanceUnit: DistanceUnit): number {
  'worklet'
  return distanceUnit === 'mi' ? (value * METERS_PER_MILE) / 1000 : value
}

export function speedUnit(distanceUnit: DistanceUnit): 'km/h' | 'mph' {
  'worklet'
  return distanceUnit === 'mi' ? 'mph' : 'km/h'
}

/** Numeric speed label; round after conversion and omit insignificant trailing zeros. */
export function formatSpeedValue(kmh: number, distanceUnit: DistanceUnit, precision = 0): string {
  'worklet'
  return String(Number(speedFromKmh(kmh, distanceUnit).toFixed(precision)))
}

export function formatSpeedKmh(kmh: number, distanceUnit: DistanceUnit, decimals = 0): string {
  'worklet'
  return `${formatSpeedValue(kmh, distanceUnit, decimals)} ${speedUnit(distanceUnit)}`
}

export function formatSpeedMps(mps: number, distanceUnit: DistanceUnit, decimals = 0): string {
  return formatSpeedKmh(mps * 3.6, distanceUnit, decimals)
}

/** Nearby distances: meters below 1 km; feet below 0.1 mile. */
export function formatDistanceMeters(meters: number, distanceUnit: DistanceUnit): string {
  if (distanceUnit === 'mi') {
    const miles = meters / METERS_PER_MILE
    return miles < 0.1 ? `${Math.round(miles * FEET_PER_MILE)} ft` : `${miles.toFixed(1)} mi`
  }
  return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`
}

export function rideDistanceFromMeters(meters: number, distanceUnit: DistanceUnit): number {
  return meters / (distanceUnit === 'mi' ? METERS_PER_MILE : 1000)
}

export function rideDistanceUnit(distanceUnit: DistanceUnit): 'km' | 'mi' {
  return distanceUnit === 'mi' ? 'mi' : 'km'
}

export function formatRideDistanceMeters(
  meters: number,
  distanceUnit: DistanceUnit,
  decimals = 1,
): string {
  return `${rideDistanceFromMeters(meters, distanceUnit).toFixed(decimals)} ${rideDistanceUnit(distanceUnit)}`
}

/** Fixed-unit lengths such as elevation and accuracy, without nearby-distance promotion. */
export function lengthFromMeters(meters: number, distanceUnit: DistanceUnit): number {
  return distanceUnit === 'mi' ? (meters * FEET_PER_MILE) / METERS_PER_MILE : meters
}

export function lengthUnit(distanceUnit: DistanceUnit): 'm' | 'ft' {
  return distanceUnit === 'mi' ? 'ft' : 'm'
}

export function formatLengthMeters(
  meters: number,
  distanceUnit: DistanceUnit,
  decimals = 0,
): string {
  return `${lengthFromMeters(meters, distanceUnit).toFixed(decimals)} ${lengthUnit(distanceUnit)}`
}

/** Preserve an untouched canonical setting exactly; convert only an actual display-unit edit. */
export function speedInputToKmh(
  nextDisplay: number,
  currentKmh: number,
  distanceUnit: DistanceUnit,
  minKmh = -Infinity,
  maxKmh = Infinity,
): number {
  if (nextDisplay === speedFromKmh(currentKmh, distanceUnit)) return currentKmh
  if (nextDisplay <= speedFromKmh(minKmh, distanceUnit)) return minKmh
  if (nextDisplay >= speedFromKmh(maxKmh, distanceUnit)) return maxKmh
  return speedToKmh(nextDisplay, distanceUnit)
}

export function lengthToMeters(value: number, distanceUnit: DistanceUnit): number {
  return value / lengthFromMeters(1, distanceUnit)
}

/** Fixed-length counterpart to speedInputToKmh; untouched drafts and physical limits stay exact. */
export function lengthInputToMeters(
  nextDisplay: number,
  currentMeters: number,
  distanceUnit: DistanceUnit,
  minMeters = -Infinity,
  maxMeters = Infinity,
): number {
  if (nextDisplay === lengthFromMeters(currentMeters, distanceUnit)) return currentMeters
  if (nextDisplay <= lengthFromMeters(minMeters, distanceUnit)) return minMeters
  if (nextDisplay >= lengthFromMeters(maxMeters, distanceUnit)) return maxMeters
  return lengthToMeters(nextDisplay, distanceUnit)
}

/** Weather temperatures are canonical °C. */
export function temperatureFromC(celsius: number, unit: TemperatureUnit): number {
  return unit === 'fahrenheit' ? (celsius * 9) / 5 + 32 : celsius
}

export function temperatureSymbol(unit: TemperatureUnit): '°C' | '°F' {
  return unit === 'fahrenheit' ? '°F' : '°C'
}
