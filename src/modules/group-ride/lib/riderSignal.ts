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
