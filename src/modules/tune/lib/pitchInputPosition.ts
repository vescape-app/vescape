import { MAX_PITCH_INPUT_DEGREES } from '@/modules/tune/lib/tunePreview'

/** Rightward drag pitches the right-side nose down in the preview. */
export function pitchInputFromTrackPosition(position: number, travel: number): number {
  'worklet'
  const fraction = Math.max(0, Math.min(1, position / Math.max(travel, 1)))
  return (1 - fraction * 2) * MAX_PITCH_INPUT_DEGREES
}

export function pitchInputTrackPosition(angleDegrees: number, travel: number): number {
  'worklet'
  return ((1 - angleDegrees / MAX_PITCH_INPUT_DEGREES) / 2) * travel
}
