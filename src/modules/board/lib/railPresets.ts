import {
  sampleRailProfile,
  sampleRailValues,
  type RailPoint,
} from '@/modules/board/lib/railProfile'

/** Side profiles authored in the rail generator's 208 × 70 coordinate space. */
const PRESETS = [
  {
    id: 'xr',
    label: 'XR',
    points: [
      [14, 32],
      [194, 32],
    ],
    smooth: [0, 0],
    thickness: 24,
    pointThickness: [24, 24],
  },
  {
    id: 'xr-classic',
    label: 'XR Classic',
    points: [
      [14, 34],
      [194, 34],
    ],
    smooth: [0, 0],
    thickness: 28,
    pointThickness: [28, 28],
  },
  {
    id: 'xr-recurve',
    label: 'XR Classic Recurve',
    points: [
      [14, 32],
      [67, 34],
      [112, 34],
      [141, 36],
      [194, 33],
    ],
    smooth: [0, 0, 29, 0, 0],
    thickness: 28,
    pointThickness: [28, 28, 28, 28, 28],
  },
  {
    id: 'gt',
    label: 'GT',
    points: [
      [14, 33],
      [67, 33],
      [91, 32],
      [118, 32],
      [140, 33],
      [194, 33],
    ],
    smooth: [0, 0, 100, 100, 0, 0],
    thickness: 33,
    pointThickness: [33, 33, 30, 30, 33, 33],
  },
  {
    id: 'gts-recurve',
    label: 'GTS Recurve',
    points: [
      [14, 32],
      [67, 33],
      [91, 32],
      [118, 32],
      [140, 35],
      [194, 33],
    ],
    smooth: [0, 0, 100, 100, 0, 0],
    thickness: 33,
    pointThickness: [33, 33, 30, 30, 33, 33],
  },
  {
    id: 'gts-xl',
    label: 'GTS XL',
    points: [
      [10, 32],
      [67, 33],
      [91, 32],
      [118, 32],
      [140, 35],
      [197, 33],
    ],
    smooth: [0, 0, 100, 100, 0, 0],
    thickness: 33,
    pointThickness: [33, 33, 30, 30, 33, 33],
  },
  {
    id: 'pint',
    label: 'Pint',
    points: [
      [19, 32],
      [186, 32],
    ],
    smooth: [0, 0],
    thickness: 23,
    pointThickness: [23, 23],
  },
  {
    id: 'x7',
    label: 'X7',
    points: [
      [14, 31],
      [67, 33],
      [90, 34],
      [117, 29],
      [141, 34],
      [194, 30],
    ],
    smooth: [0, 0, 18, 18, 0, 0],
    thickness: 24,
    pointThickness: [24, 24, 24, 24, 24, 24],
  },
  {
    id: 'x10',
    label: 'X10',
    points: [
      [10, 31],
      [67, 34],
      [90, 35],
      [117, 29],
      [141, 34],
      [195, 30],
    ],
    smooth: [0, 0, 18, 18, 0, 0],
    thickness: 24,
    pointThickness: [24, 24, 24, 24, 24, 24],
  },
  {
    id: 'thunder',
    label: 'Thunder Rails',
    points: [
      [14, 32],
      [67, 34],
      [94, 32],
      [98, 32],
      [111, 32],
      [115, 32],
      [141, 34],
      [194, 32],
    ],
    smooth: [0, 0, 0, 0, 0, 0, 0, 0],
    thickness: 24,
    pointThickness: [24, 24, 24, 34, 34, 24, 24, 24],
  },
  {
    id: 'xr-wtf',
    label: 'XR WTF',
    points: [
      [19, 32],
      [75, 35],
      [94, 32],
      [114, 32],
      [133, 35],
      [186, 32],
    ],
    smooth: [0, 0, 0, 0, 0, 0],
    thickness: 23,
    pointThickness: [23, 23, 23, 23, 23, 23],
  },
  {
    id: 'xr-wtf-btg',
    label: 'XR WTF BTG',
    points: [
      [14, 32],
      [75, 35],
      [94, 32],
      [114, 32],
      [133, 35],
      [190, 32],
    ],
    smooth: [0, 0, 0, 0, 0, 0],
    thickness: 23,
    pointThickness: [23, 23, 23, 23, 23, 23],
  },
  {
    id: 'gt-wtf',
    label: 'GT WTF',
    points: [
      [20, 32],
      [75, 35],
      [94, 32],
      [114, 32],
      [133, 35],
      [185, 32],
    ],
    smooth: [0, 0, 0, 0, 0, 0],
    thickness: 29,
    pointThickness: [29, 29, 29, 29, 29, 29],
  },
  {
    id: 'gt-wtf-btg',
    label: 'GT WTF BTG',
    points: [
      [14, 32],
      [75, 35],
      [94, 32],
      [114, 32],
      [133, 35],
      [191, 32],
    ],
    smooth: [0, 0, 0, 0, 0, 0],
    thickness: 29,
    pointThickness: [29, 29, 29, 29, 29, 29],
  },
  {
    id: 'gt-dub-tails',
    label: 'GT Dub Tails',
    points: [
      [19, 30],
      [75, 35],
      [94, 32],
      [185, 32],
    ],
    smooth: [0, 18, 39, 0],
    thickness: 29,
    pointThickness: [29, 29, 29, 29],
  },
  {
    id: 'adv',
    label: 'ADV',
    points: [
      [14, 34],
      [70, 34],
      [94, 32],
      [116, 32],
      [138, 34],
      [191, 34],
    ],
    smooth: [0, 0, 0, 0, 0, 0],
    thickness: 32,
    pointThickness: [32, 32, 30, 30, 32, 32],
  },
  {
    id: 'adv-pro',
    label: 'ADV Pro',
    points: [
      [14, 32],
      [74, 32],
      [94, 32],
      [114, 32],
      [133, 32],
      [194, 32],
    ],
    smooth: [0, 0, 0, 0, 0, 0],
    thickness: 32,
    pointThickness: [32, 32, 40, 40, 32, 32],
  },
  {
    id: 'razr-v1',
    label: 'RazrRails V1',
    points: [
      [14, 31],
      [80, 32],
      [127, 32],
      [194, 31],
    ],
    smooth: [0, 34, 34, 0],
    thickness: 17,
    pointThickness: [17, 17, 17, 17],
  },
  {
    id: 'cyber',
    label: 'CyberRails',
    points: [
      [14, 33],
      [71, 36],
      [138, 36],
      [194, 34],
    ],
    smooth: [0, 0, 0, 0],
    thickness: 24,
    pointThickness: [24, 24, 24, 24],
  },
  {
    id: 'gosmilo-x9',
    label: 'X9',
    points: [
      [14, 32],
      [74, 35],
      [93, 31],
      [131, 34],
      [194, 32],
    ],
    smooth: [0, 0, 0, 0, 0],
    thickness: 30,
    pointThickness: [30, 30, 30, 30, 30],
  },
  {
    id: 'gosmilo-x7',
    label: 'X7',
    points: [
      [14, 32],
      [71, 32],
      [93, 32],
      [116, 32],
      [138, 32],
      [194, 32],
    ],
    smooth: [0, 0, 50, 50, 0, 0],
    thickness: 30,
    pointThickness: [30, 30, 25, 25, 30, 30],
  },
] as const

export type RailId = (typeof PRESETS)[number]['id']

export const RAILS = PRESETS.map((preset) => {
  const sourcePoints = preset.points as readonly RailPoint[]
  const points = sampleRailProfile(sourcePoints, preset.smooth)
  const pointThicknesses = sampleRailValues(sourcePoints, preset.pointThickness, points)
  return { ...preset, points, pointThicknesses }
})

export function railPreset(id?: string) {
  return RAILS.find((preset) => preset.id === id) ?? RAILS[0]!
}

/** Both edges follow the same bend. The inner edge is inset at each end for the diagonal cuts. */
export function railSideFace(
  id?: string,
  customPoints?: readonly RailPoint[],
  thickness?: number,
  pointThicknesses?: readonly number[],
): RailPoint[] {
  const preset = railPreset(id)
  const points = customPoints ?? preset.points
  const railThickness = thickness ?? preset.thickness
  const railPointThicknesses =
    pointThicknesses ?? (customPoints ? undefined : preset.pointThicknesses)
  // Keep editor and built-in X coordinates in the same scale, including rail length.
  const modelX = (x: number) => ((x - 104) * 436) / 180
  const outer = points.map(
    ([x, y], index): RailPoint => [
      modelX(x),
      (railPointThicknesses?.[index] ?? railThickness) / 2 - (y - 32) * 3.5,
    ],
  )
  const bevel = Math.min(21, (outer[outer.length - 1]![0] - outer[0]![0]) / 2)
  const inner = outer.map(
    ([x, y], index): RailPoint => [
      index === 0 ? x + bevel : index === outer.length - 1 ? x - bevel : x,
      y - (railPointThicknesses?.[index] ?? railThickness),
    ],
  )
  return [...outer, ...inner.reverse()]
}

/** Longitudinal height at the deck corners and every rail bend. */
export function railDeckProfile(
  id?: string,
  customPoints?: readonly RailPoint[],
  thickness?: number,
  pointThicknesses?: readonly number[],
): RailPoint[] {
  const preset = railPreset(id)
  const railThickness = thickness ?? preset.thickness
  const railPointThicknesses =
    pointThicknesses ?? (customPoints ? undefined : preset.pointThicknesses)
  const face = railSideFace(id, customPoints, railThickness, railPointThicknesses)
  const outer = face.slice(0, face.length / 2)
  return outer.map(([x, y], index) => [x, (railPointThicknesses?.[index] ?? railThickness) / 2 - y])
}
