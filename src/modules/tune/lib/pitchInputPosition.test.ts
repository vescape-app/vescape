import { expect, test } from 'bun:test'

import {
  pitchInputFromTrackPosition,
  pitchInputTrackPosition,
} from '@/modules/tune/lib/pitchInputPosition'
import { tunePreviewDeckLine } from '@/modules/tune/lib/tunePreviewGeometry'

test('dragging toward the right-side nose tilts it down and keeps the thumb under the finger', () => {
  const travel = 200
  const rightInput = pitchInputFromTrackPosition(travel, travel)
  const leftInput = pitchInputFromTrackPosition(0, travel)
  const rightPose = tunePreviewDeckLine(rightInput, 100, 50, 40)
  const leftPose = tunePreviewDeckLine(leftInput, 100, 50, 40)

  expect(rightPose.y2).toBeGreaterThan(rightPose.y1)
  expect(leftPose.y2).toBeLessThan(leftPose.y1)
  expect(pitchInputTrackPosition(rightInput, travel)).toBe(travel)
  expect(pitchInputTrackPosition(leftInput, travel)).toBe(0)
})
