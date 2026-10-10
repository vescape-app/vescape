'worklet'
import { Skia } from '@shopify/react-native-skia'

import {
  MAX_PITCH_INPUT_DEGREES,
  MAX_PITCH_INPUT_RATE_DEGREES_PER_SECOND,
} from '@/modules/tune/lib/tunePreview'
import {
  GROUND_TICK_SPACING_METERS,
  TUNE_PREVIEW_PIXELS_PER_METER,
  TUNE_PREVIEW_WHEEL_RADIUS_PIXELS,
} from '@/modules/tune/lib/tunePreviewGeometry'

export const GROUND_Y = 58
export const WHEEL_RADIUS = TUNE_PREVIEW_WHEEL_RADIUS_PIXELS
export const DECK_HALF_LENGTH = 72
export const DECK_CENTER_Y = GROUND_Y - WHEEL_RADIUS
export const ZERO_MARKER_GAP = 6
export const ZERO_MARKER_LENGTH = 12
export const GROUND_TICK_SPACING = GROUND_TICK_SPACING_METERS * TUNE_PREVIEW_PIXELS_PER_METER
export const FOOTPAD_OFFSET = 46
const INPUT_ARROW_IDLE_GAP = 34
const INPUT_ARROW_TRAVEL = 18
const INPUT_ARROW_LENGTH = 16
const INPUT_ARROW_HEAD = 4
export const CANVAS_HEIGHT = 122
export const READOUT_FONT_SIZE = 9
export const READOUT_BASELINE = 9
export const READOUT_HEIGHT = 12
export const LEGEND_VALUE_WIDTH = 44
export const SPEED_FONT_SIZE = 16
export const SPEED_BASELINE = 17
export const SPEED_WIDTH = 38
export const SPEED_HEIGHT = 20
export const GROUND_TO_BOARD_BASELINE_Y = CANVAS_HEIGHT - 32

export function formatSignedDegrees(value: number): string {
  'worklet'
  return `${value > 0 ? '+' : ''}${value.toFixed(1)}°`
}

export function pitchInputArrow(
  angleDegrees: number,
  pitchInputDegreesValue: number,
  centerX: number,
  footpadOffset: number,
) {
  'worklet'
  const normalized =
    Math.min(MAX_PITCH_INPUT_DEGREES, Math.max(-MAX_PITCH_INPUT_DEGREES, pitchInputDegreesValue)) /
    MAX_PITCH_INPUT_DEGREES
  const magnitude = Math.abs(normalized)
  const rate =
    Math.sign(normalized) * (1 - (1 - magnitude) ** 2) * MAX_PITCH_INPUT_RATE_DEGREES_PER_SECOND
  const sideRate = footpadOffset < 0 ? Math.max(-rate, 0) : Math.max(rate, 0)
  const progress = Math.min(1, Math.max(0, sideRate / MAX_PITCH_INPUT_RATE_DEGREES_PER_SECOND))
  const radians = (angleDegrees * Math.PI) / 180
  const footpadX = centerX + Math.cos(radians) * footpadOffset
  const footpadY = DECK_CENTER_Y + Math.sin(radians) * footpadOffset
  const arrowTop = footpadY - INPUT_ARROW_IDLE_GAP + INPUT_ARROW_TRAVEL * progress
  const arrowTip = arrowTop + INPUT_ARROW_LENGTH
  const headY = arrowTip - INPUT_ARROW_HEAD
  const opacity = progress <= 0 ? 0 : 0.18 + progress * 0.82

  const path = Skia.Path.Make()
  path.moveTo(footpadX, arrowTop)
  path.lineTo(footpadX, arrowTip)
  path.moveTo(footpadX - INPUT_ARROW_HEAD, headY)
  path.lineTo(footpadX, arrowTip)
  path.lineTo(footpadX + INPUT_ARROW_HEAD, headY)
  return { path, opacity }
}
