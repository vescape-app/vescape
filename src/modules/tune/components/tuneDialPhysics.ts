const TARGET_LABEL_PX = 70
const MIN_STEP_PX = 14
const ALL_STEP_LABEL_MIN_PX = 56
const MAX_MAJOR_TICKS = 41
const MAX_MINOR_TICKS = 180

export const DRAG_RANGE_GAIN = 1
export const THROW_STOP_VELOCITY = 25
const MIN_THROW_TRANSLATION_PX = 32
const MIN_THROW_RELEASE_VELOCITY = 450
const MAX_THROW_VELOCITY = 4200
const THROW_POWER = 0.75
const THROW_FRICTION_PER_SECOND = 4

export interface TuneDialLayout {
  totalSteps: number
  totalWidth: number
  stepPx: number
  majorEvery: number
  minorEvery: number
  renderMinor: boolean
  labelEveryStep: boolean
  renderMidpointTicks: boolean
}

function niceMajorValue(range: number): number {
  if (range <= 1) return 0.1
  if (range <= 2) return 0.5
  if (range <= 5) return 1
  if (range <= 15) return 1
  if (range <= 30) return 5
  if (range <= 100) return 10
  return 50
}

export function computeTuneDialLayout(min: number, max: number, step: number): TuneDialLayout {
  const range = max - min
  const totalSteps = Math.round(range / step)

  const majorVal = niceMajorValue(range)
  const naturalMajorEvery = Math.max(1, Math.round(majorVal / step))
  const cappedMajorEvery = Math.max(naturalMajorEvery, Math.ceil(totalSteps / MAX_MAJOR_TICKS))
  const majorEvery = cappedMajorEvery
  const rawStepPx = TARGET_LABEL_PX / majorEvery
  const stepPx = Math.max(MIN_STEP_PX, rawStepPx)
  const totalWidth = totalSteps * stepPx

  const minorEvery = Math.max(
    1,
    Math.round(majorEvery / 5),
    Math.ceil(totalSteps / MAX_MINOR_TICKS),
  )
  const minMinorPx = 6
  const renderMinor = minorEvery * stepPx >= minMinorPx
  const labelEveryStep = stepPx >= ALL_STEP_LABEL_MIN_PX
  const renderMidpointTicks = labelEveryStep

  return {
    totalSteps,
    totalWidth,
    stepPx,
    majorEvery,
    minorEvery,
    renderMinor,
    labelEveryStep,
    renderMidpointTicks,
  }
}

export function computeHapticStepSpacing(): number {
  'worklet'

  return 1
}

export function shouldPlayTuneDialHaptic(
  previousStepIndex: number,
  nextStepIndex: number,
  hapticStepSpacing: number,
): boolean {
  'worklet'

  if (previousStepIndex === nextStepIndex) return false

  const spacing = Math.max(1, hapticStepSpacing)
  return Math.floor(previousStepIndex / spacing) !== Math.floor(nextStepIndex / spacing)
}

export function isTuneDialEdgeStep(stepIndex: number, totalSteps: number): boolean {
  'worklet'

  return stepIndex === 0 || stepIndex === totalSteps
}

export function shouldApplyExternalTuneDialValue(
  value: number,
  lastEmittedValue: number,
  interactionActive: boolean,
): boolean {
  return !interactionActive && value !== lastEmittedValue
}

export function resolveTuneDialThrowVelocity(
  releaseVelocityX: number,
  translationX: number,
): number {
  'worklet'

  if (Math.abs(translationX) < MIN_THROW_TRANSLATION_PX) return 0
  if (Math.abs(releaseVelocityX) < MIN_THROW_RELEASE_VELOCITY) return 0
  if (Math.sign(releaseVelocityX) !== Math.sign(translationX)) return 0

  const velocity = releaseVelocityX * THROW_POWER
  return Math.max(-MAX_THROW_VELOCITY, Math.min(MAX_THROW_VELOCITY, velocity))
}

export function resolveTuneDialThrowTargetOffset(
  startOffset: number,
  velocity: number,
  totalWidth: number,
): number {
  'worklet'

  const remainingSpeed = Math.max(0, Math.abs(velocity) - THROW_STOP_VELOCITY)
  const remainingDistance = (Math.sign(velocity) * remainingSpeed) / THROW_FRICTION_PER_SECOND
  return Math.max(-totalWidth, Math.min(0, startOffset + remainingDistance))
}

export function advanceTuneDialThrow(
  velocity: number,
  elapsedMs: number,
): { distance: number; velocity: number } {
  'worklet'

  const elapsedSeconds = Math.max(0, elapsedMs) / 1000
  const decay = Math.exp(-THROW_FRICTION_PER_SECOND * elapsedSeconds)
  return {
    distance: (velocity * (1 - decay)) / THROW_FRICTION_PER_SECOND,
    velocity: velocity * decay,
  }
}

/** Preserve physical endpoints even when their converted value is between ruler steps. */
export function tuneDialStepValue(
  index: number,
  totalSteps: number,
  min: number,
  max: number,
  step: number,
  decimals: number,
): number {
  'worklet'
  if (index <= 0) return min
  if (index >= totalSteps) return max
  return Math.max(min, Math.min(max, Number((min + index * step).toFixed(decimals))))
}
