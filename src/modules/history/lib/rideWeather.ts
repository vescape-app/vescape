import type { RideWeather } from 'vescape-core'

import { speedFromKmh, temperatureFromC, temperatureUnit, type UnitSystem } from '@/helpers/units'

/** A ride spanning less than this many °C reads as one temperature. */
const SINGLE_TEMPERATURE_SPREAD_C = 3

/** `14` when the ride barely changed, otherwise `8–20`; spread is judged in °C. */
export function rideTemperatureValue(weather: RideWeather, units: UnitSystem): string {
  const { minTemperatureC: min, maxTemperatureC: max } = weather
  const shown = (celsius: number) => Math.round(temperatureFromC(celsius, units))
  if (max - min < SINGLE_TEMPERATURE_SPREAD_C) return String(shown((min + max) / 2))
  return `${shown(min)}–${shown(max)}`
}

export function formatRideTemperature(weather: RideWeather, units: UnitSystem): string {
  return `${rideTemperatureValue(weather, units)}${temperatureUnit(units)}`
}

/** Strongest gust in the rider's speed unit, or null when no observation carried one. */
export function rideGustValue(weather: RideWeather, units: UnitSystem): number | null {
  return weather.maxGustKmh == null ? null : Math.round(speedFromKmh(weather.maxGustKmh, units))
}
