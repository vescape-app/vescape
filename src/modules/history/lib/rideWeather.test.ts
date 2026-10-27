import { expect, test } from 'bun:test'
import type { RideWeather } from 'vescape-core'

import { formatRideTemperature, rideGustValue } from '@/modules/history/lib/rideWeather'

const weather = (min: number, max: number, gust: number | null = 20): RideWeather => ({
  icon: 'cloud',
  minTemperatureC: min,
  maxTemperatureC: max,
  maxGustKmh: gust,
  rainMinutes: 0,
})

test('a spread under 3 °C reads as one temperature, wider as a range', () => {
  expect(formatRideTemperature(weather(14, 14), 'celsius')).toBe('14°C')
  expect(formatRideTemperature(weather(13, 15), 'celsius')).toBe('14°C')
  expect(formatRideTemperature(weather(8, 20), 'celsius')).toBe('8–20°C')
  expect(formatRideTemperature(weather(10, 13), 'celsius')).toBe('10–13°C')
})

test('fahrenheit and mph convert but judges the spread in °C', () => {
  expect(formatRideTemperature(weather(8, 20), 'fahrenheit')).toBe('46–68°F')
  expect(formatRideTemperature(weather(14, 16), 'fahrenheit')).toBe('59°F')
  expect(rideGustValue(weather(0, 0, 40), 'mi')).toBe(25)
  expect(rideGustValue(weather(0, 0, null), 'mi')).toBeNull()
})
