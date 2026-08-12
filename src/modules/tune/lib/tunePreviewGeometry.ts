export interface TunePreviewDeckLine {
  x1: number
  y1: number
  x2: number
  y2: number
}

export const TUNE_PREVIEW_WHEEL_RADIUS_PIXELS = 25
export const REFERENCE_WHEEL_DIAMETER_METERS = 11 * 0.0254
export const TUNE_PREVIEW_PIXELS_PER_METER =
  (TUNE_PREVIEW_WHEEL_RADIUS_PIXELS * 2) / REFERENCE_WHEEL_DIAMETER_METERS
export const GROUND_TICK_SPACING_METERS = 1

export function terrainHeightRelativeToWheel(
  xPixels: number,
  travelMeters: number,
  heightMeters: number,
  spacingMeters: number,
): number {
  'worklet'
  const wave = (2 * Math.PI) / spacingMeters
  const amplitudeMeters = heightMeters / 2
  const xMeters = xPixels / TUNE_PREVIEW_PIXELS_PER_METER
  const centerHeightMeters = amplitudeMeters * Math.sin(-travelMeters * wave)
  const pointHeightMeters = amplitudeMeters * Math.sin((xMeters - travelMeters) * wave)
  return (pointHeightMeters - centerHeightMeters) * TUNE_PREVIEW_PIXELS_PER_METER
}

export function tunePreviewDeckLine(
  angleDegrees: number,
  centerX: number,
  centerY: number,
  halfLength: number,
): TunePreviewDeckLine {
  'worklet'
  const radians = (angleDegrees * Math.PI) / 180
  const dx = Math.cos(radians) * halfLength
  const dy = Math.sin(radians) * halfLength
  return { x1: centerX - dx, y1: centerY - dy, x2: centerX + dx, y2: centerY + dy }
}

export function responseLeanAngleDegrees(
  aggressivenessLevel: number,
  stiffnessLevel = 0,
  wheelRadiusPixels = TUNE_PREVIEW_WHEEL_RADIUS_PIXELS,
  deckHalfLengthPixels = 72,
): number {
  const level = Math.min(10, Math.max(0, aggressivenessLevel))
  const contactAngleDegrees =
    (Math.asin(Math.min(1, wheelRadiusPixels / deckHalfLengthPixels)) * 180) / Math.PI
  const nearGroundAngle = contactAngleDegrees * 0.84
  const firmAngle = 2
  const response = (level / 10) ** 0.8
  const aggressivenessAngle = nearGroundAngle + (firmAngle - nearGroundAngle) * response
  const support = Math.min(10, Math.max(0, stiffnessLevel)) / 10
  return firmAngle + (aggressivenessAngle - firmAngle) * (1 - support * 0.7)
}
