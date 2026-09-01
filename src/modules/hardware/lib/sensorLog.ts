import { makeMutable, type SharedValue } from 'react-native-reanimated'

import { measureLinkRate } from '@/modules/hardware/lib/linkRate'
import type { SensorFrame } from '@/modules/hardware/lib/parseSensorFrame'
import { readingValue } from '@/modules/hardware/lib/sensorReadings'

/**
 * How much history the charts show. The board is a live instrument here — what a sensor did half
 * a minute ago is not what anyone is reading it for — and a shorter window keeps every point on
 * screen worth a pixel.
 */
const HISTORY_MS = 20_000

/** Hard cap, so a board reporting faster than expected cannot grow the buffer without bound. */
const MAX_FRAMES = 2000

/**
 * The board's frame history, deliberately outside React.
 *
 * At 50 frames a second a Zustand store is the wrong container: every frame would copy the whole
 * history and wake every subscriber, and the screen would reconcile fifty times a second to move
 * a chart one pixel. Here the history is mutated in place, live numbers go to shared values the
 * UI thread reads directly, and React is told only that something changed — it decides when to
 * look, at its own pace.
 */
const frames: SensorFrame[] = []

/** Bumped on every append, so a poller can tell "nothing new" from "same length after a trim". */
let version = 0

/** Latest value per key, in display units, for text that updates without a render. NaN is "-". */
const live = new Map<string, SharedValue<number>>()

/** Keys seen on this link, in the order the board first sent them. */
let keys: string[] = []
let keysVersion = 0

/** When each key first carried a value, so a chart knows how far back it may draw. */
const firstSeen = new Map<string, number>()

export const linkHz = makeMutable(Number.NaN)
export const linkDropped = makeMutable(Number.NaN)
export const linkReadMs = makeMutable(Number.NaN)

/** Shared value for a key, created on first sight so a new sensor needs no wiring. */
export function liveValue(key: string): SharedValue<number> {
  const existing = live.get(key)
  if (existing) return existing
  const created = makeMutable(Number.NaN)
  live.set(key, created)
  return created
}

export function appendFrame(frame: SensorFrame): void {
  frames.push(frame)
  // Trimmed by age rather than count: the window is a span of time whatever rate fills it.
  let stale = 0
  while (stale < frames.length && (frames[stale]?.atMs ?? 0) < frame.atMs - HISTORY_MS) stale += 1
  if (frames.length - stale > MAX_FRAMES) stale = frames.length - MAX_FRAMES
  if (stale > 0) frames.splice(0, stale)
  version += 1

  for (const key of Object.keys(frame.values)) {
    if (!keys.includes(key)) {
      keys = [...keys, key]
      firstSeen.set(key, frame.atMs)
      keysVersion += 1
    }
  }
  // Every known key is written every frame, not just the ones present: a sensor that stopped
  // answering has to fall back to its ceiling, or its row freezes on a stale number.
  for (const key of keys) liveValue(key).value = readingValue(key, frame.values[key] ?? null) ?? NaN

  const rate = measureLinkRate(frames)
  linkHz.value = rate.hz ?? Number.NaN
  linkDropped.value = rate.dropped
  linkReadMs.value = rate.readMs ?? Number.NaN
}

export function clearFrames(): void {
  frames.length = 0
  keys = []
  firstSeen.clear()
  version += 1
  keysVersion += 1
  for (const value of live.values()) value.value = Number.NaN
  linkHz.value = Number.NaN
  linkDropped.value = Number.NaN
  linkReadMs.value = Number.NaN
}

export function readFrames(): readonly SensorFrame[] {
  return frames
}

export function frameVersion(): number {
  return version
}

export function readKeys(): readonly string[] {
  return keys
}

export function keySetVersion(): number {
  return keysVersion
}

export function readFirstSeen(): ReadonlyMap<string, number> {
  return firstSeen
}
