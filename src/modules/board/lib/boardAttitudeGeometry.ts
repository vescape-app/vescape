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
  yawDegrees = 0,
): AttitudeMatrix {
  'worklet'
  const angle = (((rollDegrees ?? 0) % 360) * Math.PI) / 180
  const sin = Math.sin(angle)
  const cos = Math.cos(angle)
  const yaw = (yawDegrees * Math.PI) / 180
  const slope = (height1 - height0) / (x1 - x0)
  return [
    Math.cos(yaw),
    Math.sin(yaw),
    0,
    slope * cos,
    -sin,
    (baseHeight + height0 - slope * x0) * cos,
    0,
    0,
    1,
  ]
}

export function endOnTirePose(rollDegrees: number | null, yawDegrees: number | null) {
  'worklet'
  const roll = ((rollDegrees ?? 0) * Math.PI) / 180
  const yaw = ((yawDegrees ?? 0) * Math.PI) / 180
  const rawCos = Math.cos(yaw)
  const cos = Math.abs(rawCos) < 1e-8 ? 0 : rawCos
  return {
    matrix: [Math.sin(yaw), 0, 0, -Math.sin(roll), Math.cos(roll), 0, 0, 0, 1] as AttitudeMatrix,
    opacity: Math.max(0, 1 - Math.abs(cos) / 0.05),
  }
}

function plane(yScale: number, yOffset = 0, xScale = 1, xOffset = 0): AttitudeMatrix {
  'worklet'
  return [xScale, 0, xOffset, 0, yScale, yOffset, 0, 0, 1]
}

/**
 * Roll changes plane transforms and which faces are in front. Pitch is a separate 2D rotation,
 * preserving the strip's existing clockwise-positive convention. Yaw turns the board toward
 * its nose or tail with orthographic projection.
 */
export function boardAttitudePose(
  rollDegrees: number | null,
  railThickness = RAIL_THICKNESS,
  leftThickness = railThickness,
  rightThickness = railThickness,
  yawDegrees = 0,
  leftCapX = -197,
  rightCapX = 197,
  capLength = 21,
) {
  'worklet'
  const roll = rollDegrees != null && Number.isFinite(rollDegrees) ? rollDegrees : 0
  const angle = (roll % 360) * (Math.PI / 180)
  // Exact edge-on poses must not leave nearly-singular slivers in the renderer.
  const rawSin = Math.sin(angle)
  const rawCos = Math.cos(angle)
  const sin = Math.abs(rawSin) < 1e-8 ? 0 : rawSin
  const cos = Math.abs(rawCos) < 1e-8 ? 0 : rawCos
  const rawYawSin = Math.sin((yawDegrees * Math.PI) / 180)
  const rawYawCos = Math.cos((yawDegrees * Math.PI) / 180)
  const yawSin = Math.abs(rawYawSin) < 1e-8 ? 0 : rawYawSin
  const yawCos = Math.abs(rawYawCos) < 1e-8 ? 0 : rawYawCos
  const nearSide = cos < 0 ? 1 : -1
  const nearTireY = -nearSide * TIRE_HALF_WIDTH * sin
  const farWidth = -nearSide * RAIL_HALF_WIDTH
  const nearWidth = -farWidth
  const nearTireWidth = nearSide * TIRE_HALF_WIDTH
  const farTireWidth = -nearTireWidth
  return {
    farRail: plane(-cos, nearSide * RAIL_HALF_WIDTH * sin, yawCos, farWidth * yawSin),
    nearRail: plane(-cos, -nearSide * RAIL_HALF_WIDTH * sin, yawCos, nearWidth * yawSin),
    nearTire: plane(Math.abs(cos), nearTireY, yawCos, nearTireWidth * yawSin),
    farTire: plane(Math.abs(cos), -nearTireY, yawCos, farTireWidth * yawSin),
    farTireArc: plane(
      Math.abs(cos) * (nearTireY < 0 ? -1 : 1),
      -nearTireY,
      yawCos,
      farTireWidth * yawSin,
    ),
    tread: [yawCos, yawSin, 0, 0, Math.abs(sin), 0, 0, 0, 1] as AttitudeMatrix,
    top: [yawCos, yawSin, 0, 0, -sin, -(railThickness / 2) * cos, 0, 0, 1] as AttitudeMatrix,
    bottom: [yawCos, yawSin, 0, 0, -sin, (railThickness / 2) * cos, 0, 0, 1] as AttitudeMatrix,
    // Cap coordinates are (end bevel distance, board width). The ends are diagonal cuts.
    rightCap: [
      yawCos,
      yawSin,
      rightCapX * yawCos,
      (-rightThickness / capLength) * cos,
      -sin,
      (rightThickness / 2) * cos,
      0,
      0,
      1,
    ] as AttitudeMatrix,
    leftCap: [
      -yawCos,
      yawSin,
      leftCapX * yawCos,
      (-leftThickness / capLength) * cos,
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
