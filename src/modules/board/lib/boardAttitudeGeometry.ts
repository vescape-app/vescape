/** Orthographic XR pictogram dimensions, in model units. Centered on the wheel axle. */
export const ATTITUDE_EXTENT = 480
export const TIRE_RADIUS = 78
export const TIRE_HALF_WIDTH = 43
export const RAIL_HALF_WIDTH = 64
export const RAIL_THICKNESS = 24

export type AttitudeMatrix = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
]

export function curvedDeckMatrix(
  rollDegrees: number | null,
  x0: number,
  x1: number,
  height0: number,
  height1: number,
  baseHeight: number,
): AttitudeMatrix {
  'worklet'
  const angle = (((rollDegrees ?? 0) % 360) * Math.PI) / 180
  const sin = Math.sin(angle)
  const cos = Math.cos(angle)
  const slope = (height1 - height0) / (x1 - x0)
  return [1, 0, 0, slope * cos, -sin, (baseHeight + height0 - slope * x0) * cos, 0, 0, 1]
}

function plane(yScale: number, yOffset = 0): AttitudeMatrix {
  'worklet'
  return [1, 0, 0, 0, yScale, yOffset, 0, 0, 1]
}

/**
 * Roll changes plane transforms and which faces are in front. Pitch is a separate 2D rotation,
 * preserving the strip's existing clockwise-positive convention. No perspective or camera yaw.
 */
export function boardAttitudePose(
  rollDegrees: number | null,
  railThickness = RAIL_THICKNESS,
  leftThickness = railThickness,
  rightThickness = railThickness,
) {
  'worklet'
  const roll = rollDegrees != null && Number.isFinite(rollDegrees) ? rollDegrees : 0
  const angle = (roll % 360) * (Math.PI / 180)
  // Exact edge-on poses must not leave nearly-singular slivers in the renderer.
  const rawSin = Math.sin(angle)
  const rawCos = Math.cos(angle)
  const sin = Math.abs(rawSin) < 1e-8 ? 0 : rawSin
  const cos = Math.abs(rawCos) < 1e-8 ? 0 : rawCos
  const nearSide = cos < 0 ? 1 : -1
  const nearTireY = -nearSide * TIRE_HALF_WIDTH * sin
  return {
    farRail: plane(-cos, nearSide * RAIL_HALF_WIDTH * sin),
    nearRail: plane(-cos, -nearSide * RAIL_HALF_WIDTH * sin),
    nearTire: plane(Math.abs(cos), nearTireY),
    farTire: plane(Math.abs(cos), -nearTireY),
    farTireArc: plane(Math.abs(cos) * (nearTireY < 0 ? -1 : 1), -nearTireY),
    tread: plane(Math.abs(sin)),
    top: plane(-sin, -(railThickness / 2) * cos),
    bottom: plane(-sin, (railThickness / 2) * cos),
    // Cap coordinates are (end bevel distance, board width). The ends are diagonal cuts.
    rightCap: [
      1,
      0,
      197,
      (-rightThickness / 21) * cos,
      -sin,
      (rightThickness / 2) * cos,
      0,
      0,
      1,
    ] as AttitudeMatrix,
    leftCap: [
      -1,
      0,
      -197,
      (-leftThickness / 21) * cos,
      -sin,
      (leftThickness / 2) * cos,
      0,
      0,
      1,
    ] as AttitudeMatrix,
    // Skia discards singular matrices. A static side-on contour takes over within
    // a subpixel distance of 90 degrees, so the wheel and rails never disappear.
    edgeOnOpacity: Math.max(0, 1 - Math.abs(cos) / 0.03),
    topVisible: sin >= 0 ? 1 : 0,
    bottomVisible: sin < 0 ? 1 : 0,
  }
}
