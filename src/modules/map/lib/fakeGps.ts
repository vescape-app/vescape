/**
 * Synthetic GPS / compass drivers for the camera engine playground.
 *
 * Pure math: the screen owns the timers and feeds `dtSeconds`. Truth position
 * advances noise-free; noise is applied only to the *reported* fix, mirroring a
 * real receiver whose track is smooth but whose samples wobble.
 */

export type FakeGpsMode = 'straight' | 'curvy' | 'jitter'

export interface FakeGpsState {
  /** Noise-free truth position, [lng, lat]. */
  position: [number, number]
  /** Base course in degrees; curvy modes swing around it. */
  courseDeg: number
  elapsedS: number
}

export interface FakeGpsSample {
  state: FakeGpsState
  /** What the receiver "reports" — truth plus mode noise. */
  reported: [number, number]
  /** Instantaneous heading actually travelled this step. */
  headingDeg: number
}

const EARTH_RADIUS_M = 6_378_137
const CURVE_AMPLITUDE_DEG = 55
const CURVE_PERIOD_S = 14
const JITTER_MIN_M = 5
const JITTER_MAX_M = 15

export function createFakeGpsState(origin: [number, number], courseDeg = 45): FakeGpsState {
  return { position: [origin[0], origin[1]], courseDeg, elapsedS: 0 }
}

/** Offset a coordinate by `distanceM` along `headingDeg` (0 = north, clockwise). */
export function offsetCoordinate(
  [lng, lat]: [number, number],
  headingDeg: number,
  distanceM: number,
): [number, number] {
  const headingRad = (headingDeg * Math.PI) / 180
  const latRad = (lat * Math.PI) / 180
  const dLat = ((distanceM * Math.cos(headingRad)) / EARTH_RADIUS_M) * (180 / Math.PI)
  const dLng =
    ((distanceM * Math.sin(headingRad)) / (EARTH_RADIUS_M * Math.cos(latRad))) * (180 / Math.PI)
  return [lng + dLng, lat + dLat]
}

export function advanceFakeGps({
  state,
  mode,
  speedKmh,
  dtSeconds,
  random = Math.random,
}: {
  state: FakeGpsState
  mode: FakeGpsMode
  speedKmh: number
  dtSeconds: number
  random?: () => number
}): FakeGpsSample {
  const elapsedS = state.elapsedS + dtSeconds
  const swing =
    mode === 'straight'
      ? 0
      : CURVE_AMPLITUDE_DEG * Math.sin((elapsedS / CURVE_PERIOD_S) * Math.PI * 2)
  const headingDeg = state.courseDeg + swing
  const distanceM = (speedKmh / 3.6) * dtSeconds
  const position = offsetCoordinate(state.position, headingDeg, distanceM)

  const reported =
    mode === 'jitter'
      ? offsetCoordinate(
          position,
          random() * 360,
          JITTER_MIN_M + random() * (JITTER_MAX_M - JITTER_MIN_M),
        )
      : position

  return { state: { position, courseDeg: state.courseDeg, elapsedS }, reported, headingDeg }
}

/**
 * Phone-compass stand-in: a slow continuous rotation with optional hand-shake
 * noise, so heading retargets arrive far faster than GPS fixes.
 */
export function fakeCompassHeading({
  elapsedS,
  degPerSecond,
  noiseDeg,
  random = Math.random,
}: {
  elapsedS: number
  degPerSecond: number
  noiseDeg: number
  random?: () => number
}): number {
  const base = elapsedS * degPerSecond + (noiseDeg > 0 ? (random() * 2 - 1) * noiseDeg : 0)
  return ((base % 360) + 360) % 360
}
