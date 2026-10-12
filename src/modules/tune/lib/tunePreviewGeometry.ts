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
  const centerHeightMeters = amplitudeMeters * Math.sin(travelMeters * wave)
  const pointHeightMeters = amplitudeMeters * Math.sin((xMeters + travelMeters) * wave)
  return (centerHeightMeters - pointHeightMeters) * TUNE_PREVIEW_PIXELS_PER_METER
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
  return { x1: centerX - dx, y1: centerY + dy, x2: centerX + dx, y2: centerY - dy }
}
