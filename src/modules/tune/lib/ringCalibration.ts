import { APP_TUNE_FIELD_BY_ID } from './fields'

export const DEFAULT_RING_ANCHORS = {
  kp: [15, 22.5, 30],
  kp2: [0.4, 0.75, 1.1],
  ki: [0.015, 0.0225, 0.03],
  mahony_kp: [2.2, 1.85, 1.5],
  mahony_kp_roll: [2.2, 1.85, 1.5],
  torquetilt_strength: [0, 0.15, 0.3],
  torquetilt_strength_regen: [0, 0.15, 0.3],
  turntilt_speed: [0, 50, 100],
  braketilt_lingering: [5, 3, 1],
  atr_response_boost: [1, 1.5, 2],
  atr_strength_down: [0, 1, 2],
  atr_strength_up: [0, 1, 2],
} satisfies Record<string, [number, number, number]>
export type RingCalibrationField = keyof typeof DEFAULT_RING_ANCHORS
export type RingAnchors = Record<RingCalibrationField, [number, number, number]>

/** Bundled Refloat 1.2.x reference bounds, not a substitute for live native validation. */
const RING_CALIBRATION_LIMITS: Partial<Record<RingCalibrationField, { min: number; max: number }>> =
  {
    kp: { min: 0, max: 40 },
    kp2: { min: 0, max: 3 },
    mahony_kp: { min: 0.2, max: 3 },
    mahony_kp_roll: { min: 0, max: 3 },
    turntilt_speed: { min: 0, max: 100 },
    atr_response_boost: { min: 1, max: 2 },
  }

export function validateRingAnchors(anchors: RingAnchors): string | null {
  for (const id of Object.keys(DEFAULT_RING_ANCHORS) as RingCalibrationField[]) {
    const field = RING_CALIBRATION_LIMITS[id] ?? APP_TUNE_FIELD_BY_ID.get(id)!
    const values = anchors[id]
    if (values.some((v) => !Number.isFinite(v) || v < field.min || v > field.max)) {
      return `${id}: use finite values within ${field.min}…${field.max}.`
    }
    const increasing = DEFAULT_RING_ANCHORS[id][2] > DEFAULT_RING_ANCHORS[id][0]
    if (
      increasing
        ? values[0] >= values[1] || values[1] >= values[2]
        : values[0] <= values[1] || values[1] <= values[2]
    ) {
      return `${id}: anchors must stay strictly ${increasing ? 'increasing' : 'decreasing'}.`
    }
  }
  return null
}
