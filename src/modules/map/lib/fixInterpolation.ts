/**
 * Longest a single glide may take. There is deliberately no lower bound: the glide must never
 * outlast the gap it is covering.
 *
 * A floor looks harmless and is not. When fixes arrive faster than it — a replay warmup, a burst
 * after a stall — each glide outlives the gap it covers, so the puck falls further behind with
 * every fix while the trail keeps up. The line then runs ahead to the newest fix and doubles back
 * to the lagging puck. Following the measured cadence exactly, however fast, is what keeps the two
 * together.
 */
const MAX_GLIDE_MS = 2_000
/** Fallback until two fixes have been seen and an interval can be measured. */
export const DEFAULT_GLIDE_MS = 1_000

export interface FixCoordinate {
  latitude: number
  longitude: number
}

/**
 * How long the puck should take to travel from one fix to the next.
 *
 * Measured from arrivals rather than assumed, because the cadence is not ours to pick: a phone GPS,
 * a replay at speed and a degraded stream all arrive at their own rate, and the glide has to finish
 * as the next fix lands whatever that rate is.
 *
 * A gap far outside the usual cadence means the stream stalled — a tunnel, a dropped session, a
 * replay seeking. Gliding across a ten-second hole would crawl the puck for ten seconds through a
 * position it has long left, so the cap turns anything that long into a short catch-up instead.
 */
export function glideDurationMs(previousFixAtMs: number | null, fixAtMs: number): number {
  if (previousFixAtMs == null) return DEFAULT_GLIDE_MS
  const measured = fixAtMs - previousFixAtMs
  if (!Number.isFinite(measured) || measured <= 0) return DEFAULT_GLIDE_MS
  return Math.min(measured, MAX_GLIDE_MS)
}

/**
 * Position along the straight line between two fixes. Linear is the honest choice: it claims
 * nothing about the path that the fixes themselves do not say, and at one-second spacing the
 * difference from a curve is well under the accuracy of the fixes being joined.
 *
 * Longitude is interpolated the short way around so a track crossing the antimeridian sweeps a few
 * metres rather than the whole globe.
 */
export function interpolateFix(from: FixCoordinate, to: FixCoordinate, t: number): FixCoordinate {
  const clamped = Math.min(Math.max(t, 0), 1)
  // Land exactly on the endpoints. Arriving a floating-point hair off the measured fix would leave
  // the puck permanently that far from where the receiver actually put it, and the error would
  // accumulate across every glide.
  if (clamped === 0) return { latitude: from.latitude, longitude: from.longitude }
  if (clamped === 1) return { latitude: to.latitude, longitude: to.longitude }
  let deltaLongitude = to.longitude - from.longitude
  if (deltaLongitude > 180) deltaLongitude -= 360
  if (deltaLongitude < -180) deltaLongitude += 360
  const longitude = from.longitude + deltaLongitude * clamped
  return {
    latitude: from.latitude + (to.latitude - from.latitude) * clamped,
    longitude: ((longitude + 540) % 360) - 180,
  }
}
