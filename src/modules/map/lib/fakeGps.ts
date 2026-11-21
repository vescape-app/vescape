import { offsetCoordinate } from '@/helpers/mapGeometry'

export type FakeGpsMode = 'straight' | 'curvy' | 'jitter'

export interface FakeGpsState {
  position: [number, number]
  courseDeg: number
  elapsedS: number
}

export interface FakeGpsSample {
  state: FakeGpsState
  reported: [number, number]
  headingDeg: number
}

const CURVE_AMPLITUDE_DEG = 55
const CURVE_PERIOD_S = 14
const JITTER_MIN_M = 5
const JITTER_MAX_M = 15

export function createFakeGpsState(origin: [number, number], courseDeg = 45): FakeGpsState {
  return { position: [origin[0], origin[1]], courseDeg, elapsedS: 0 }
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
