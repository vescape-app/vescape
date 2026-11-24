import type { TuneProfileFieldValue } from 'vescape-core'

import {
  getFieldOverlay,
  type ResolvedBoardConfigField,
  type ResolvedBoardConfigGroup,
} from '@/modules/board/lib/refloatFieldOverlay'
import { formatTuneValue } from '@/modules/tune/lib/fields'
import { isDisplayableFieldValue } from '@/modules/tune/lib/fieldValues'

export interface BasicSliderItem {
  id: string
  label: string
  description: string
  value: number | null
  min: number
  max: number
  step: number
  source: string
  info: string
  modifiedManually: boolean
}

export interface BasicSliderDefinition {
  id: string
  label: string
  description: string
  min: number
  max: number
  step: number
  source: string
  info: string
  linkedFields: string[]
  deriveSliderValue: (fields: Map<string, number | null>) => number | null
  computeFieldValues: (sliderValue: number) => Record<string, number>
  checkMatch: (fields: Map<string, number | null>) => boolean
}

const EPSILON = 0.015

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function interpolate(
  x: number,
  inputRange: [number, number],
  outputRange: [number, number],
): number {
  const [inMin, inMax] = inputRange
  const [outMin, outMax] = outputRange
  return outMin + ((x - inMin) / (inMax - inMin)) * (outMax - outMin)
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

function nearEqual(a: number, b: number): boolean {
  return Math.abs(a - b) <= EPSILON
}

export function fieldStep(
  field: Pick<ResolvedBoardConfigField, 'id' | 'min' | 'max' | 'step'> & { value?: unknown },
): number {
  const explicitStep = field.step ?? getFieldOverlay(field.id)?.step
  if (explicitStep != null && Number.isFinite(explicitStep) && explicitStep > 0) {
    return explicitStep
  }
  const range = (field.max ?? 1) - (field.min ?? 0)
  if (range <= 1) return 0.01
  if (range <= 5) return 0.05
  if (range <= 20) return 0.1
  if (range <= 100) return 1
  return 10
}

export function snapValue(value: number, min: number, max: number, step: number): number {
  const snapped = Math.round((value - min) / step) * step + min
  const decimals = step < 1 ? Math.ceil(Math.abs(Math.log10(step))) : 0
  return Number(clamp(snapped, min, max).toFixed(decimals))
}

export function formatSliderValue(item: BasicSliderItem): string {
  if (item.value == null) return 'Missing'
  return Number.isInteger(item.value) ? item.value.toFixed(0) : item.value.toFixed(1)
}

export function formatProfileValue(value: TuneProfileFieldValue | undefined): string {
  return isDisplayableFieldValue(value) ? formatTuneValue(value) : 'Missing'
}

export function isEditableNumberField(field: ResolvedBoardConfigField): boolean {
  return (
    field.editable &&
    field.enumNames.length === 0 &&
    typeof field.value === 'number' &&
    Number.isFinite(field.value) &&
    field.min != null &&
    field.max != null &&
    Number.isFinite(field.min) &&
    Number.isFinite(field.max) &&
    field.max > field.min
  )
}

export function fieldHelp(
  field: Pick<ResolvedBoardConfigField, 'id' | 'description' | 'enumNames'>,
): string {
  const description = field.description?.trim() || getFieldOverlay(field.id)?.description?.trim()
  if (description) return description
  if (field.enumNames.length > 0) {
    return `Options: ${field.enumNames.join(', ')}.`
  }
  return 'Field decoded from the board custom config schema.'
}

const BASIC_SLIDERS: BasicSliderDefinition[] = [
  {
    id: 'aggressiveness',
    label: 'Aggressiveness',
    description: 'Controls how strongly the board stays balanced.',
    min: -5,
    max: 10,
    step: 1,
    source: 'kp',
    info: 'Coordinates PID and Mahony filter values. Derived from kp - 20.',
    linkedFields: ['kp', 'kp2', 'ki', 'mahony_kp', 'mahony_kp_roll'],
    deriveSliderValue: (fields) => {
      const kp = fields.get('kp')
      return kp == null ? null : clamp(kp - 20, -5, 10)
    },
    computeFieldValues: (x) => ({
      kp: roundTo(interpolate(x, [-5, 10], [15, 30]), 0),
      kp2: roundTo(interpolate(x, [-5, 10], [0.4, 1.1]), 1),
      ki: roundTo(interpolate(x, [-5, 10], [0.015, 0.03]), 3),
      mahony_kp: roundTo(interpolate(x, [-5, 10], [2.2, 1.5]), 1),
      mahony_kp_roll: roundTo(interpolate(x, [-5, 10], [2.2, 1.5]), 1),
    }),
    checkMatch: (fields) => {
      const kp = fields.get('kp')
      if (kp == null) return true
      const x = clamp(kp - 20, -5, 10)
      const expected = {
        kp2: roundTo(interpolate(x, [-5, 10], [0.4, 1.1]), 1),
        ki: roundTo(interpolate(x, [-5, 10], [0.015, 0.03]), 3),
        mahony_kp: roundTo(interpolate(x, [-5, 10], [2.2, 1.5]), 1),
        mahony_kp_roll: roundTo(interpolate(x, [-5, 10], [2.2, 1.5]), 1),
      }
      return Object.entries(expected).every(([id, val]) => {
        const actual = fields.get(id)
        return actual == null || nearEqual(actual, val)
      })
    },
  },
  {
    id: 'noseStiffness',
    label: 'Nose stiffness',
    description: 'Lifts the nose when accelerating.',
    min: 0,
    max: 10,
    step: 1,
    source: 'torquetilt_strength',
    info: 'Acceleration torque tiltback. Nose lift from positive output current.',
    linkedFields: ['torquetilt_strength'],
    deriveSliderValue: (fields) => {
      const v = fields.get('torquetilt_strength')
      return v == null ? null : clamp(v / 0.03, 0, 10)
    },
    computeFieldValues: (x) => ({ torquetilt_strength: roundTo(x * 0.03, 2) }),
    checkMatch: () => true,
  },
  {
    id: 'tailStiffness',
    label: 'Tail stiffness',
    description: 'Lowers the nose when braking.',
    min: 0,
    max: 10,
    step: 1,
    source: 'torquetilt_strength_regen',
    info: 'Regen torque tiltback. Nose lowering from negative regen current.',
    linkedFields: ['torquetilt_strength_regen'],
    deriveSliderValue: (fields) => {
      const v = fields.get('torquetilt_strength_regen')
      return v == null ? null : clamp(v / 0.03, 0, 10)
    },
    computeFieldValues: (x) => ({ torquetilt_strength_regen: roundTo(x * 0.03, 2) }),
    checkMatch: () => true,
  },
  {
    id: 'carveTilt',
    label: 'Carve tilt',
    description: 'Adds extra lean when turning into a carve.',
    min: 0,
    max: 15,
    step: 1,
    source: 'turntilt_strength',
    info: 'Turn tiltback strength. Direct 1:1 mapping.',
    linkedFields: ['turntilt_strength'],
    deriveSliderValue: (fields) => {
      const v = fields.get('turntilt_strength')
      return v == null ? null : clamp(v, 0, 15)
    },
    computeFieldValues: (x) => ({ turntilt_strength: x }),
    checkMatch: () => true,
  },
  {
    id: 'brakeTilt',
    label: 'Brake tilt',
    description: 'Lifts the nose during hard braking.',
    min: 0,
    max: 5,
    step: 1,
    source: 'braketilt_strength',
    info: 'Brake tiltback strength. Direct 1:1 mapping.',
    linkedFields: ['braketilt_strength'],
    deriveSliderValue: (fields) => {
      const v = fields.get('braketilt_strength')
      return v == null ? null : clamp(v, 0, 5)
    },
    computeFieldValues: (x) => ({ braketilt_strength: x }),
    checkMatch: () => true,
  },
  {
    id: 'atrIntensity',
    label: 'ATR intensity',
    description: 'Automatically changes the board angle during climbs and descents.',
    min: 0,
    max: 15,
    step: 1,
    source: 'atr_strength_up/down',
    info: 'ATR uphill and downhill strength, mapped from 0..2 to 0..15.',
    linkedFields: ['atr_strength_up', 'atr_strength_down'],
    deriveSliderValue: (fields) => {
      const up = fields.get('atr_strength_up')
      const down = fields.get('atr_strength_down')
      const stronger = up != null || down != null ? Math.max(up ?? 0, down ?? 0) : null
      return stronger == null ? null : clamp(interpolate(stronger, [0, 2], [0, 15]), 0, 15)
    },
    computeFieldValues: (x) => {
      const val = roundTo(interpolate(x, [0, 15], [0, 2]), 1)
      return { atr_strength_up: val, atr_strength_down: val }
    },
    checkMatch: (fields) => {
      const up = fields.get('atr_strength_up')
      const down = fields.get('atr_strength_down')
      if (up == null && down == null) return true
      return up != null && down != null && nearEqual(up, down)
    },
  },
]

export function basicSliderChanges(
  def: BasicSliderDefinition,
  value: number,
  originalValue: number,
  linkedFieldValues?: Record<string, number>,
): Record<string, number> {
  return { ...(value === originalValue ? {} : def.computeFieldValues(value)), ...linkedFieldValues }
}

export const BASIC_SLIDER_BY_ID = new Map(BASIC_SLIDERS.map((s) => [s.id, s]))

export function basicSlidersFromGroups(
  groups: ResolvedBoardConfigGroup[],
  overrideFields?: Map<string, number | null>,
): BasicSliderItem[] {
  const fieldMap = overrideFields ?? new Map<string, number | null>()
  if (!overrideFields) {
    for (const group of groups) {
      for (const field of group.fields) {
        const v =
          typeof field.value === 'number' && Number.isFinite(field.value) ? field.value : null
        fieldMap.set(field.id, v)
      }
    }
  }

  return BASIC_SLIDERS.map((slider) => ({
    id: slider.id,
    label: slider.label,
    description: slider.description,
    value: slider.deriveSliderValue(fieldMap),
    min: slider.min,
    max: slider.max,
    step: slider.step,
    source: slider.source,
    info: slider.info,
    modifiedManually: !slider.checkMatch(fieldMap),
  }))
}

export interface LinkedFieldPreview {
  id: string
  label: string
  unit: string | null
  min: number
  max: number
  step: number
  currentValue?: number
  computeValue: (sliderVal: number) => number
}

export function getLinkedFieldPreviews(
  def: BasicSliderDefinition,
  resolvedFieldsById?: ReadonlyMap<string, ResolvedBoardConfigField>,
): LinkedFieldPreview[] {
  return def.linkedFields.map((fieldId) => {
    const resolved = resolvedFieldsById?.get(fieldId)
    const overlay = getFieldOverlay(fieldId)
    const min = resolved?.min ?? overlay?.softRange?.min ?? 0
    const max = resolved?.max ?? overlay?.softRange?.max ?? 100
    const step = fieldStep({
      id: fieldId,
      min,
      max,
      step: resolved?.step ?? overlay?.step ?? null,
    })
    return {
      id: fieldId,
      label: resolved?.label ?? overlay?.label ?? fieldId,
      unit: resolved?.unit ?? null,
      min,
      max,
      step,
      computeValue: (sliderVal: number) => def.computeFieldValues(sliderVal)[fieldId],
    }
  })
}
