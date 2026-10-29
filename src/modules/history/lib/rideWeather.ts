import type { RideWeather } from 'vescape-core'

import {
  speedFromKmh,
  temperatureFromC,
  temperatureSymbol,
  type TemperatureUnit,
  type DistanceUnit,
} from '@/helpers/units'

/** A ride spanning less than this many °C reads as one temperature. */
const SINGLE_TEMPERATURE_SPREAD_C = 3

/** `14` when the ride barely changed, otherwise `8–20`; spread is judged in °C. */
export function rideTemperatureValue(weather: RideWeather, unit: TemperatureUnit): string {
  const { minTemperatureC: min, maxTemperatureC: max } = weather
  const shown = (celsius: number) => Math.round(temperatureFromC(celsius, unit))
  if (max - min < SINGLE_TEMPERATURE_SPREAD_C) return String(shown((min + max) / 2))
  return `${shown(min)}–${shown(max)}`
}

export function formatRideTemperature(weather: RideWeather, unit: TemperatureUnit): string {
  return `${rideTemperatureValue(weather, unit)}${temperatureSymbol(unit)}`
}

/** Strongest gust in the rider's speed unit, or null when no observation carried one. */
export function rideGustValue(weather: RideWeather, distanceUnit: DistanceUnit): number | null {
  return weather.maxGustKmh == null
    ? null
    : Math.round(speedFromKmh(weather.maxGustKmh, distanceUnit))
}
