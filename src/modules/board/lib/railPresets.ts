import { buildRailPath, type RailPoint } from '@/modules/board/lib/railProfile'
import { RAIL_THICKNESS } from '@/modules/board/lib/boardAttitudeGeometry'

/** Side profiles authored in the rail generator's 208 × 70 coordinate space. */
const PRESETS = [
  {
    id: 'xr',
    label: 'XR',
    points: [
      [30, 32],
      [179, 32],
    ],
  },
  {
    id: 'wtf',
    label: 'WTF',
    points: [
      [29, 32],
      [81, 37],
      [96, 32],
      [112, 32],
      [129, 37],
      [178, 32],
    ],
  },
  {
    id: 'x7',
    label: 'X7',
    points: [
      [29, 29],
      [81, 37],
      [96, 29],
      [114, 36],
      [129, 37],
      [178, 28],
    ],
  },
  {
    id: 'tail',
    label: 'Tail Rails',
    points: [
      [29, 31],
      [119, 32],
      [154, 30],
      [179, 27],
    ],
  },
  {
    id: 'moustache',
    label: 'Moustache',
    points: [
      [30, 29],
      [79, 34],
      [128, 34],
      [179, 27],
    ],
  },
] as const

export type RailId = (typeof PRESETS)[number]['id']

/** The generator profiles face left. Mirror them around its 208 px canvas for right-facing boards. */
export const RAILS = PRESETS.map((preset) => {
  const points = [...preset.points].reverse().map(([x, y]): RailPoint => [208 - x, y])
  return { ...preset, points, path: buildRailPath(points, []) }
})

export function railPreset(id?: string) {
  return RAILS.find((preset) => preset.id === id) ?? RAILS[0]!
}

/** Both edges follow the same bend. The inner edge is inset at each end for the diagonal cuts. */
export function railSideFace(
  id?: string,
  customPoints?: readonly RailPoint[],
  thickness = RAIL_THICKNESS,
  pointThicknesses?: readonly number[],
): RailPoint[] {
  const points = customPoints ?? railPreset(id).points
  const firstX = points[0]![0]
  const lastX = points[points.length - 1]![0]
  // Keep editor X in a fixed model scale so moving either end changes the rail length.
  const modelX = customPoints
    ? (x: number) => ((x - 104) * 436) / 180
    : (x: number) => -218 + ((x - firstX) * 436) / (lastX - firstX)
  const outer = points.map(
    ([x, y], index): RailPoint => [
      modelX(x),
      (pointThicknesses?.[index] ?? thickness) / 2 - (y - 32) * 3.5,
    ],
  )
  const bevel = Math.min(21, (outer[outer.length - 1]![0] - outer[0]![0]) / 2)
  const inner = outer.map(
    ([x, y], index): RailPoint => [
      index === 0 ? x + bevel : index === outer.length - 1 ? x - bevel : x,
      y - (pointThicknesses?.[index] ?? thickness),
    ],
  )
  return [...outer, ...inner.reverse()]
}

/** Longitudinal height at the deck corners and every rail bend. */
export function railDeckProfile(
  id?: string,
  customPoints?: readonly RailPoint[],
  thickness = RAIL_THICKNESS,
  pointThicknesses?: readonly number[],
): RailPoint[] {
  const face = railSideFace(id, customPoints, thickness, pointThicknesses)
  const outer = face.slice(0, face.length / 2)
  return outer.map(([x, y], index) => [x, (pointThicknesses?.[index] ?? thickness) / 2 - y])
}
