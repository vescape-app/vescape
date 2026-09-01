import { makeMutable, type SharedValue } from 'react-native-reanimated'

import type { HardwareSensorEvent, HardwareSeries, HardwareSeriesEvent } from 'vescape-core'

/**
 * The JS end of the native sensor log.
 *
 * Native parses, scales, clamps, buffers and decimates; this holds what came across. Live numbers
 * go straight into shared values the UI thread reads, so a reading updates without a React render
 * at all. Only the two things React must see — which rows exist, and the decimated series — are
 * published, and only when they change.
 *
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/hardware/SensorLog.kt
 */

/** Latest value per key, in display units. NaN is a sensor with nothing to say. */
const live = new Map<string, SharedValue<number>>()

export const linkHz = makeMutable(Number.NaN)
export const linkDropped = makeMutable(Number.NaN)
export const linkReadMs = makeMutable(Number.NaN)

let keys: readonly string[] = []
let series: readonly HardwareSeries[] = []
let version = 0

const listeners = new Set<() => void>()

/** Shared value for a key, created on first sight so a new sensor needs no wiring. */
export function liveValue(key: string): SharedValue<number> {
  const existing = live.get(key)
  if (existing) return existing
  const created = makeMutable(Number.NaN)
  live.set(key, created)
  return created
}

export function applySensor(event: HardwareSensorEvent): void {
  for (let index = 0; index < event.keys.length; index++) {
    const key = event.keys[index]
    if (key == null) continue
    liveValue(key).value = event.values[index] ?? Number.NaN
  }
  linkHz.value = event.hz ?? Number.NaN
  linkDropped.value = event.dropped
  linkReadMs.value = event.readMs ?? Number.NaN

  // The row list is the only part of this React needs, and it changes when hardware is plugged
  // in, not fifty times a second.
  if (!sameKeys(keys, event.keys)) {
    keys = event.keys
    publish()
  }
}

export function applySeries(event: HardwareSeriesEvent): void {
  series = event.series
  publish()
}

export function resetSensors(): void {
  keys = []
  series = []
  for (const value of live.values()) value.value = Number.NaN
  linkHz.value = Number.NaN
  linkDropped.value = Number.NaN
  linkReadMs.value = Number.NaN
  publish()
}

export function subscribeSensors(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function sensorVersion(): number {
  return version
}

export function readSensorKeys(): readonly string[] {
  return keys
}

export function readSensorSeries(): readonly HardwareSeries[] {
  return series
}

function publish(): void {
  version += 1
  for (const listener of listeners) listener()
}

function sameKeys(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((key, index) => key === b[index])
}
