// THROWAWAY: real editor ranges; local prototype values are normalized only for geometry.
import { APP_TUNE_FIELD_BY_ID } from '@/modules/tune/lib/fields'
import { basicSlidersFromGroups, fieldStep, fieldHelp } from '@/modules/tune/lib/sliderDefinitions'

const basicControls = basicSlidersFromGroups([])
const basic = (id: string) => ({
  ...basicControls.find((control) => control.id === id)!,
  unit: null as string | null,
})
const field = (id: string, description?: string) => {
  const definition = APP_TUNE_FIELD_BY_ID.get(id)!
  return {
    ...definition,
    description: description ?? fieldHelp({ ...definition, value: 0 }),
    step: fieldStep({ ...definition, value: 0 }),
  }
}
// Single source: ranges and steps come from the existing production tune editors.
export const CONTROLS = [
  [basic('aggressiveness'), basic('tailStiffness'), basic('noseStiffness'), basic('brakeTilt')],
  [
    basic('brakeTilt'),
    basic('carveTilt'),
    field('turntilt_angle_limit'),
    field('braketilt_lingering'),
  ],
  [
    field('atr_response_boost', 'Sets how strongly ATR responds.'),
    field('atr_strength_down', 'Lowers the nose on descents.'),
    field('atr_strength_up', 'Lifts the nose on climbs.'),
    field('atr_off_speed'),
  ],
]
const SIMPLE_CONTROLS = CONTROLS.map((group) =>
  group.map((control) => ({
    ...control,
    min: 0,
    max: 10,
    step: 0.1,
    unit: null,
  })),
)
export const controlsForVariant = (variant: number) => (variant === 2 ? CONTROLS : SIMPLE_CONTROLS)

export function realValue(percent: number, page: number, index: number, variant: number) {
  const { min, max, step } = controlsForVariant(variant)[page][index]
  const snapped = min + Math.round(((percent / 100) * (max - min)) / step) * step
  return Number(Math.max(min, Math.min(max, snapped)).toFixed(3))
}

export const GROUPS = [
  {
    name: 'Feel',
    labels: ['Aggressiveness', 'Tail stiffness', 'Nose stiffness', 'Braking'],
    defaults: [55, 45, 60, 50],
  },
  {
    name: 'Brake / Turn',
    labels: ['Brake tilt', 'Carve tilt', 'Turn tilt limit', 'Brake lingering'],
    defaults: [60, 45, 35, 40],
  },
  {
    name: 'ATR',
    labels: ['ATR response boost', 'Downhill strength', 'Uphill strength', 'ATR release speed'],
    defaults: [50, 40, 65, 55],
  },
] as const

// Demo presets for comparing the UI; these are not calibrated firmware tunes.
export const TUNE_PRESETS = [
  {
    name: 'Trail Flow',
    values: [
      [60, 55, 65, 50],
      [55, 65, 45, 40],
      [60, 55, 70, 55],
    ],
  },
  {
    name: 'Street Cruise',
    values: [
      [45, 50, 50, 50],
      [50, 40, 35, 40],
      [35, 35, 40, 55],
    ],
  },
  {
    name: 'Trick Mode',
    values: [
      [75, 70, 70, 50],
      [65, 25, 25, 40],
      [20, 20, 20, 55],
    ],
  },
  {
    name: 'Coffee Run',
    values: [
      [30, 35, 40, 50],
      [35, 35, 30, 40],
      [30, 30, 35, 55],
    ],
  },
  {
    name: 'All-Rounder',
    values: [
      [50, 50, 55, 50],
      [50, 50, 45, 40],
      [50, 45, 55, 55],
    ],
  },
]
