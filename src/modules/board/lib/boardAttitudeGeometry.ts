/** Orthographic XR pictogram dimensions, in model units. Centered on the wheel axle. */
export const ATTITUDE_EXTENT = 480
export const TIRE_RADIUS = 78
export const TIRE_HALF_WIDTH = 43
export const RAIL_HALF_WIDTH = 64
export const RAIL_HALF_HEIGHT = 12

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

function plane(yScale: number, yOffset = 0): AttitudeMatrix {
  'worklet'
  return [1, 0, 0, 0, yScale, yOffset, 0, 0, 1]
}

/**
 * Roll changes plane transforms and which faces are in front. Pitch is a separate 2D rotation,
 * preserving the strip's existing clockwise-positive convention. No perspective or camera yaw.
 */
export function boardAttitudePose(rollDegrees: number | null) {
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
    top: plane(-sin, -RAIL_HALF_HEIGHT * cos),
    bottom: plane(-sin, RAIL_HALF_HEIGHT * cos),
    // Cap coordinates are (end bevel distance, board width). The ends are diagonal cuts.
    rightCap: [1, 0, 197, (-24 / 21) * cos, -sin, 12 * cos, 0, 0, 1] as AttitudeMatrix,
    leftCap: [-1, 0, -197, (-24 / 21) * cos, -sin, 12 * cos, 0, 0, 1] as AttitudeMatrix,
    // Skia discards singular matrices. A static side-on contour takes over within
    // a subpixel distance of 90 degrees, so the wheel and rails never disappear.
    edgeOnOpacity: Math.max(0, 1 - Math.abs(cos) / 0.03),
    topVisible: sin >= 0 ? 1 : 0,
    bottomVisible: sin < 0 ? 1 : 0,
  }
}
