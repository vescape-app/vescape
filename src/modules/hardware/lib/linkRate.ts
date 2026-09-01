import type { SensorFrame } from '@/modules/hardware/lib/parseSensorFrame'

/** Window the rate is averaged over. Short enough to react, long enough not to flicker. */
const WINDOW_MS = 3000

export interface LinkRate {
  /** Frames per second actually delivered, or null until there are two frames to time. */
  hz: number | null
  /** Frames the board numbered but the app never received, inside the window. */
  dropped: number
  /** What the board's newest frame cost to gather, the floor under any requested rate. */
  readMs: number | null
}

/**
 * What the link is really doing, as opposed to what the board was asked for. The board stamps
 * every frame with `seq`, so a rate below the requested one can be told apart from notifications
 * the phone dropped: a slow board keeps its sequence intact, a saturated link skips numbers.
 *
 * @parity ../vescape-hardware/src/main.cpp `sensorFrame`
 */
export function measureLinkRate(frames: readonly SensorFrame[]): LinkRate {
  const latest = frames.at(-1)
  const readMs = latest?.values.readMs ?? null
  if (latest == null) return { hz: null, dropped: 0, readMs }

  // Scanned backwards from the head rather than filtered: this runs on every arriving frame, and
  // a copy of the whole history fifty times a second is exactly the cost being avoided here.
  const cutoff = latest.atMs - WINDOW_MS
  let first = frames.length - 1
  while (first > 0 && (frames[first - 1]?.atMs ?? 0) >= cutoff) first -= 1
  const count = frames.length - first
  if (count < 2) return { hz: null, dropped: 0, readMs }

  const span = latest.atMs - (frames[first]?.atMs ?? 0)
  const hz = span > 0 ? (count - 1) / (span / 1000) : null

  let dropped = 0
  for (let i = first + 1; i < frames.length; i++) {
    const previous = frames[i - 1]?.values.seq
    const current = frames[i]?.values.seq
    if (previous == null || current == null) continue
    if (current > previous) dropped += current - previous - 1
  }
  return { hz, dropped, readMs }
}
