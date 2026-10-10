import { buildRailPath, type RailPoint } from '@/modules/board/lib/railProfile'

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
export function railSideFace(id?: string): RailPoint[] {
  const points = railPreset(id).points
  const firstX = points[0]![0]
  const lastX = points[points.length - 1]![0]
  const outer = points.map(
    ([x, y]): RailPoint => [-218 + ((x - firstX) * 436) / (lastX - firstX), 12 - (y - 32) * 3.5],
  )
  const inner = outer.map(
    ([x, y], index): RailPoint => [
      index === 0 ? -197 : index === outer.length - 1 ? 197 : x,
      y - 24,
    ],
  )
  return [...outer, ...inner.reverse()]
}

/** Longitudinal height at the deck corners and every rail bend. */
export function railDeckProfile(id?: string): RailPoint[] {
  const face = railSideFace(id)
  const outer = face.slice(0, face.length / 2)
  return outer.map(([x, y]) => [x, 12 - y])
}
