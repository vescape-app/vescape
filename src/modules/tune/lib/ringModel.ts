import type { TuneProfileFieldValue } from 'vescape-core'
import type { RingAnchors, RingCalibrationField } from './ringCalibration'

export const RING_SECTIONS = ['Feel', 'Brake / Turn', 'ATR'] as const
export const RING_CONTROLS = [
  {
    label: 'Aggressiveness',
    fields: ['kp', 'kp2', 'ki', 'mahony_kp', 'mahony_kp_roll'],
    help: 'Coordinates PID and Mahony response. Calibration is experimental.',
  },
  {
    label: 'Tail stiffness',
    fields: ['torquetilt_strength_regen'],
    help: 'Nose lowering from regen current. Independent from Brake Tilt.',
  },
  {
    label: 'Nose stiffness',
    fields: ['torquetilt_strength'],
    help: 'Nose lift from positive motor current.',
  },
  {
    label: 'Response speed',
    fields: ['turntilt_speed', 'braketilt_lingering'],
    help: 'Higher values apply Turn Tilt faster and release Brake Tilt faster. Base ATR speeds stay unchanged.',
  },
  {
    label: 'Braking',
    fields: ['braketilt_strength'],
    help: '0 allows more lean-back through extra nose lift. 10 disables that extra Brake Tilt. This does not increase braking force or PID stiffness.',
  },
  {
    label: 'Turning',
    fields: ['turntilt_strength'],
    help: 'Negative lowers the nose; positive raises it. Zero disables Turn Tilt. Circle size does not guarantee ground clearance.',
  },
  {
    label: 'Response Boost',
    fields: ['atr_response_boost'],
    help: 'Increases ATR application speed at higher ERPM. Does not change base response speed or strength.',
  },
  {
    label: 'Downhill strength',
    fields: ['atr_strength_down'],
    help: 'Independent downhill ATR strength.',
  },
  {
    label: 'Uphill strength',
    fields: ['atr_strength_up'],
    help: 'Independent uphill ATR strength.',
  },
] as const
export type RingFields = Record<string, TuneProfileFieldValue>
export interface RingProjection {
  value: number
  custom: boolean
  unavailable: boolean
  outOfRange: boolean
}

function evaluate(points: readonly number[], value: number) {
  const segment = value <= 5 ? 0 : 1
  return points[segment] + (points[segment + 1] - points[segment]) * ((value - segment * 5) / 5)
}
function pointsFor(anchors: RingAnchors, field: string): readonly number[] {
  if (field === 'braketilt_strength') return [5, 2.5, 0]
  if (field === 'turntilt_strength') return [-15, 0, 15]
  return anchors[field as RingCalibrationField]
}
/** Values passed here use normalized 0…10, including Turning (-5…5 in presentation). */
export function ringControlPatch(
  anchors: RingAnchors,
  control: number,
  value: number,
  encodingScales: Record<string, number | null | undefined> = {},
): Record<string, number> {
  if (!Number.isFinite(value) || value < 0 || value > 10)
    throw new Error('Ring value must be within 0…10')
  return Object.fromEntries(
    RING_CONTROLS[control].fields.map((id) => {
      const raw = evaluate(pointsFor(anchors, id), value)
      const scale = encodingScales[id]
      return [id, scale != null && scale > 0 ? Math.floor(raw * scale + 0.5) / scale : raw]
    }),
  )
}
/** Projection has no inverse write side effects. Compound mismatch remains Custom. */
export function projectRingControl(
  anchors: RingAnchors,
  control: number,
  fields: RingFields,
  encodingScales: Record<string, number | null | undefined> = {},
): RingProjection {
  const definition = RING_CONTROLS[control]
  if (
    definition.fields.some((id) => typeof fields[id] !== 'number' || !Number.isFinite(fields[id]))
  ) {
    return { value: 5, custom: true, unavailable: true, outOfRange: false }
  }
  const id = definition.fields[0]
  const raw = fields[id] as number
  const points = pointsFor(anchors, id)
  const increasing = points[2] > points[0]
  const segment = (increasing ? raw <= points[1] : raw >= points[1]) ? 0 : 1
  const unbounded =
    segment * 5 + (5 * (raw - points[segment])) / (points[segment + 1] - points[segment])
  const projected = Math.max(0, Math.min(10, unbounded))
  const value = encodingScales[id] ? Math.round(projected * 10) / 10 : projected
  const patch = ringControlPatch(anchors, control, value)
  const custom =
    unbounded < 0 ||
    unbounded > 10 ||
    Object.entries(patch).some(([field, expected]) => {
      const scale = encodingScales[field]
      const rawValue = fields[field] as number
      if (scale != null && scale > 0)
        return Math.floor(rawValue * scale + 0.5) !== Math.floor(expected * scale + 0.5)
      return Math.abs(rawValue - expected) > Math.max(1e-7, Math.abs(expected) * 2e-7)
    })
  return { value, custom, unavailable: false, outOfRange: unbounded < 0 || unbounded > 10 }
}
export function ringSectionPatch(
  anchors: RingAnchors,
  section: number,
  values: readonly number[],
  encodingScales: Record<string, number | null | undefined> = {},
): Record<string, number> {
  return Object.assign(
    {},
    ...values
      .slice(0, 3)
      .map((value, axis) => ringControlPatch(anchors, section * 3 + axis, value, encodingScales)),
  )
}

/** Rider-calibration starting points, not validated ride-feel equivalence. */
export const RING_PRESETS = [
  [
    { name: 'Soft', values: [1, 1, 1] },
    { name: 'Firm', values: [9, 9, 9] },
    { name: 'Trail', values: [6, 5, 6] },
    { name: 'Street', values: [5, 4, 4] },
    { name: 'Tricks', values: [2, 1, 1] },
    { name: 'Chillout', values: [2, 2, 2] },
  ],
  [
    { name: 'Mission', values: [5, 2, 2] },
    { name: 'Brake Support', values: [5, 8, 5] },
    { name: 'Smooth', values: [2, 4, 5] },
    { name: 'Tricks', values: [4, 2, 8] },
    { name: 'Chillout', values: [1, 3, 5] },
  ],
  [
    { name: 'Street', values: [1, 1.5, 2] },
    { name: 'Trail', values: [7, 5.5, 6] },
    { name: 'Mountain', values: [9, 8, 9] },
    { name: 'Flow', values: [8, 2.5, 3] },
  ],
] as const
