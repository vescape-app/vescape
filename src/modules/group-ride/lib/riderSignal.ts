import type { GroupRidePin } from 'vescape-core'

/**
 * The relay clock as of the last roster: its `now`, and the local monotonic time it arrived. Signal
 * times are relay times, so they are only ever compared with this, never with `Date.now()`.
 */
export interface RelayClock {
  relayNow: number
  receivedAt: number
}

/** Monotonic local milliseconds, immune to phone clock changes. */
export const monotonicNow = (): number => performance.now()

/** Relay time now, advanced from the last roster by local elapsed time. */
export function relayNow(clock: RelayClock, localNow = monotonicNow()): number {
  return clock.relayNow + (localNow - clock.receivedAt)
}

/** Milliseconds until the signal expires, never negative. */
export function signalTimeLeftMs(
  signal: GroupRidePin,
  clock: RelayClock,
  localNow = monotonicNow(),
): number {
  return Math.max(0, signal.expiresAt - relayNow(clock, localNow))
}

/**
 * The signal to surface first among several active ones: the highest `rank` (a rider down over a
 * problem, a problem over a wait), then the newest. Expired signals and unknown kinds (`rankOf`
 * returns null) never win. Null when none is active.
 */
export function topRiderSignal(
  signals: readonly GroupRidePin[],
  clock: RelayClock,
  rankOf: (kind: string) => number | null,
  localNow = monotonicNow(),
): GroupRidePin | null {
  let top: GroupRidePin | null = null
  let topRank = -Infinity
  for (const signal of signals) {
    const rank = rankOf(signal.kind)
    if (rank === null || signalTimeLeftMs(signal, clock, localNow) <= 0) continue
    if (top === null || rank > topRank || (rank === topRank && signal.startedAt > top.startedAt)) {
      top = signal
      topRank = rank
    }
  }
  return top
}
