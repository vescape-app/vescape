import type { RefloatConfigField, RefloatConfigGroup, TuneProfileFieldValue } from 'vescape-core'

import { APP_TUNE_FIELD_BY_ID, formatTuneValue } from '@/modules/tune/lib/fields'
import { isDisplayableFieldValue } from '@/modules/tune/lib/fieldValues'

const FIELD_INFO: Record<string, string> = {
  kp: 'Main proportional angle response. Higher values make the board respond more strongly to nose angle error.',
  kp2: 'Responds to angular velocity. This acts like damping and is especially noticeable during fast or aggressive nose-angle changes.',
  kp_brake: 'Multiplier for angle response while braking.',
  kp2_brake: 'Multiplier for rate response while braking.',
  ki: 'Integral angle correction. This helps remove sustained angle error over time.',
  ki_limit: 'Limits how much authority the integral correction can build up.',
  mahony_kp:
    'Pitch-axis Mahony filter accelerometer correction. Higher values feel looser and linger more; lower values feel snappier.',
  mahony_kp_roll:
    'Roll-axis Mahony filter correction. Lower roll correction can help the nose hold up in turns and make tight carves feel stiffer.',
  atr_strength_up:
    'Nose lift applied from adaptive torque response during uphill or acceleration load.',
  atr_strength_down:
    'Nose lowering applied from adaptive torque response during downhill or braking load.',
  atr_threshold_up: 'Angle threshold before uphill ATR behavior starts.',
  atr_threshold_down: 'Angle threshold before downhill ATR behavior starts.',
  atr_speed_boost: 'Boosts ATR response as speed increases.',
  atr_angle_limit: 'Maximum angle ATR tiltback is allowed to apply.',
  atr_on_speed: 'Maximum speed where ATR tiltback can be applied.',
  atr_off_speed: 'Maximum speed where ATR tiltback can be released.',
  atr_response_boost: 'Boost factor for tiltback response.',
  atr_transition_boost: 'Boost factor around ATR response transitions.',
  atr_filter: 'Current filter frequency used by ATR.',
  atr_amps_accel_ratio: 'Ratio used by acceleration-side ATR behavior.',
  atr_amps_decel_ratio: 'Ratio used by deceleration-side ATR behavior.',
  torquetilt_strength:
    'Nose lift based on positive output current. The basic Nose stiffness control writes this value.',
  torquetilt_strength_regen:
    'Nose lowering based on negative regen current. The basic Tail stiffness control writes this value.',
  torquetilt_start_current: 'Current threshold before torque tiltback starts.',
  torquetilt_angle_limit: 'Maximum angle torque tiltback is allowed to apply.',
  torquetilt_on_speed: 'Maximum speed where torque tiltback can be applied.',
  torquetilt_off_speed: 'Maximum speed where torque tiltback can be released.',
  turntilt_strength:
    'Turn tiltback strength. The basic Carve tilt control writes this directly. Tune Preview does not show it because Carve Tilt requires a turn scenario.',
  turntilt_angle_limit: 'Maximum turn tiltback angle.',
  turntilt_start_angle: 'Turn aggregate threshold before turn tiltback response starts.',
  turntilt_start_erpm: 'ERPM threshold before turn tiltback response starts.',
  turntilt_speed: 'Maximum speed where turn tiltback can be applied.',
  turntilt_erpm_boost: 'Speed-based boost percentage for turn tiltback.',
  turntilt_erpm_boost_end: 'ERPM where turn tiltback speed boost reaches its maximum.',
  turntilt_yaw_aggregate: 'Target accumulated yaw or turn value for turn tiltback.',
  braketilt_strength: 'Brake tilt strength. The basic Brake tilt control writes this directly.',
  braketilt_lingering: 'Controls how brake tilt lingers or releases after braking.',
  tiltback_constant: 'Constant nose angle offset.',
  tiltback_constant_erpm: 'Forward speed threshold where Constant Tiltback begins.',
  tiltback_variable: 'Variable tiltback amount per ERPM.',
  tiltback_variable_max: 'Maximum variable tiltback target.',
  tiltback_variable_erpm: 'Forward speed threshold where Variable Tiltback begins.',
}

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

export function fieldStep(field: RefloatConfigField): number {
  const explicitStep = APP_TUNE_FIELD_BY_ID.get(field.id)?.step
  if (explicitStep != null) return explicitStep
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

export function isEditableNumberField(field: RefloatConfigField): boolean {
  return (
    typeof field.value === 'number' &&
    Number.isFinite(field.value) &&
    field.min != null &&
    field.max != null &&
    Number.isFinite(field.min) &&
    Number.isFinite(field.max) &&
    field.max > field.min
  )
}

export function fieldHelp(field: RefloatConfigField): string {
  return FIELD_INFO[field.id] ?? 'Read-only field decoded from the board custom config schema.'
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

/** Opening an editor does not opt into replacing custom linked values with a formula. */
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
  groups: RefloatConfigGroup[],
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

export function getLinkedFieldPreviews(def: BasicSliderDefinition): LinkedFieldPreview[] {
  return def.linkedFields.map((fieldId) => {
    const appField = APP_TUNE_FIELD_BY_ID.get(fieldId)
    return {
      id: fieldId,
      label: appField?.label ?? fieldId,
      unit: appField?.unit ?? null,
      min: appField?.min ?? 0,
      max: appField?.max ?? 100,
      step: appField
        ? fieldStep({
            id: appField.id,
            label: appField.label,
            value: def.computeFieldValues(def.min)[fieldId],
            min: appField.min,
            max: appField.max,
            unit: appField.unit,
          })
        : 0.1,
      computeValue: (sliderVal: number) => def.computeFieldValues(sliderVal)[fieldId],
    }
  })
}
