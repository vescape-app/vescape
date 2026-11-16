import type { PublicRideStatus } from 'vescape-core'

/** Hours the switch can run for before it turns itself off. */
export const PUBLIC_RIDE_DURATIONS = [1, 2, 3, 4, 6, 8, 10, 12, 24, 48, 72, 96, 120, 144, 168]

const HOUR_MS = 3_600_000

export type PublicRideChoice =
  { mode: 'off' } | { mode: 'always' } | { mode: 'hours'; hours: number }

export function publicRideDurationLabel(hours: number) {
  return hours >= 48 ? `${hours / 24} d` : `${hours} h`
}

/** The end time native gets for a choice: null for off and always. */
export function publicRideUntil(choice: PublicRideChoice, now: number): number | null {
  return choice.mode === 'hours' ? now + choice.hours * HOUR_MS : null
}

/**
 * The switch position for a native status. A running timer shows the shortest duration that still
 * covers the time left, so the selector never claims less than the rider has.
 */
export function publicRideChoice(status: PublicRideStatus, now: number): PublicRideChoice {
  if (status.activation === 'off') return { mode: 'off' }
  if (status.until == null) return { mode: 'always' }
  const left = (status.until - now) / HOUR_MS
  const hours =
    PUBLIC_RIDE_DURATIONS.find((duration) => duration >= left - 1 / 60) ??
    PUBLIC_RIDE_DURATIONS[PUBLIC_RIDE_DURATIONS.length - 1]
  return { mode: 'hours', hours }
}
