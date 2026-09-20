/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/PersistenceDefaults.kt `validUnitSystem`
 * @parity /modules/vescape-core/ios/telemetry/PersistenceDefaults.swift `validUnitSystem`
 */
export type UnitSystem = 'metric' | 'imperial'

export const METERS_PER_MILE = 1609.344
const FEET_PER_MILE = 5280

/** Board telemetry and persisted speed thresholds use km/h. */
export function speedFromKmh(kmh: number, units: UnitSystem): number {
  'worklet'
  return units === 'imperial' ? (kmh * 1000) / METERS_PER_MILE : kmh
}

/** GPS speed uses m/s. */
export function speedFromMps(mps: number, units: UnitSystem): number {
  'worklet'
  return speedFromKmh(mps * 3.6, units)
}

export function speedToKmh(value: number, units: UnitSystem): number {
  'worklet'
  return units === 'imperial' ? (value * METERS_PER_MILE) / 1000 : value
}

export function speedUnit(units: UnitSystem): 'km/h' | 'mph' {
  'worklet'
  return units === 'imperial' ? 'mph' : 'km/h'
}

export function formatSpeedKmh(kmh: number, units: UnitSystem, decimals = 0): string {
  return `${speedFromKmh(kmh, units).toFixed(decimals)} ${speedUnit(units)}`
}

export function formatSpeedMps(mps: number, units: UnitSystem, decimals = 0): string {
  return formatSpeedKmh(mps * 3.6, units, decimals)
}

/** Nearby distances: meters below 1 km; feet below 0.1 mile. */
export function formatDistanceMeters(meters: number, units: UnitSystem): string {
  if (units === 'imperial') {
    const miles = meters / METERS_PER_MILE
    return miles < 0.1 ? `${Math.round(miles * FEET_PER_MILE)} ft` : `${miles.toFixed(1)} mi`
  }
  return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`
}

export function rideDistanceFromMeters(meters: number, units: UnitSystem): number {
  return meters / (units === 'imperial' ? METERS_PER_MILE : 1000)
}

export function rideDistanceUnit(units: UnitSystem): 'km' | 'mi' {
  return units === 'imperial' ? 'mi' : 'km'
}

export function formatRideDistanceMeters(meters: number, units: UnitSystem, decimals = 1): string {
  return `${rideDistanceFromMeters(meters, units).toFixed(decimals)} ${rideDistanceUnit(units)}`
}

/** Fixed-unit lengths such as elevation and accuracy, without nearby-distance promotion. */
export function lengthFromMeters(meters: number, units: UnitSystem): number {
  return units === 'imperial' ? (meters * FEET_PER_MILE) / METERS_PER_MILE : meters
}

export function lengthUnit(units: UnitSystem): 'm' | 'ft' {
  return units === 'imperial' ? 'ft' : 'm'
}

export function formatLengthMeters(meters: number, units: UnitSystem, decimals = 0): string {
  return `${lengthFromMeters(meters, units).toFixed(decimals)} ${lengthUnit(units)}`
}

/** Preserve an untouched canonical setting exactly; convert only an actual display-unit edit. */
export function speedInputToKmh(
  nextDisplay: number,
  currentKmh: number,
  units: UnitSystem,
  minKmh = -Infinity,
  maxKmh = Infinity,
): number {
  if (nextDisplay === speedFromKmh(currentKmh, units)) return currentKmh
  if (nextDisplay <= speedFromKmh(minKmh, units)) return minKmh
  if (nextDisplay >= speedFromKmh(maxKmh, units)) return maxKmh
  return speedToKmh(nextDisplay, units)
}
