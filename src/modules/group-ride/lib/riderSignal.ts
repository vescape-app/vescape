import type { GroupRideSignal } from 'vescape-core'

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
  signal: GroupRideSignal,
  clock: RelayClock,
  localNow = monotonicNow(),
): number {
  return Math.max(0, signal.expiresAt - relayNow(clock, localNow))
}

/**
 * The signal to surface first among several active ones: a critical kind over the rest, then the
 * newest. Expired signals and unknown kinds (`isCritical` returns null) never win. Null when none
 * is active.
 */
export function topRiderSignal(
  signals: readonly GroupRideSignal[],
  clock: RelayClock,
  isCritical: (kind: string) => boolean | null,
  localNow = monotonicNow(),
): GroupRideSignal | null {
  let top: GroupRideSignal | null = null
  let topCritical = false
  for (const signal of signals) {
    const critical = isCritical(signal.kind)
    if (critical === null || signalTimeLeftMs(signal, clock, localNow) <= 0) continue
    const wins =
      top === null ||
      (critical && !topCritical) ||
      (critical === topCritical && signal.startedAt > top.startedAt)
    if (wins) {
      top = signal
      topCritical = critical
    }
  }
  return top
}
