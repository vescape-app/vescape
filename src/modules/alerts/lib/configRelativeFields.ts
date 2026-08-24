/**
 * The board config fields an Alert Preset can anchor itself to, and what each one *means*.
 *
 * A config-relative rule stores only a field id and an offset (ADR 0035): the relationship is the
 * durable truth, and the concrete threshold is resolved against whatever the board currently
 * reports. Resolving needs two things the field id alone does not carry — which config the field
 * lives in, and what units it is in — so they live here, once, rather than being denormalized onto
 * every rule. They are properties of the VESC/Refloat field itself, not of the rider's rule.
 *
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/ConfigRelativeFields.kt
 * @parity /modules/vescape-core/ios/alerts/ConfigRelativeFields.swift
 */

/** Which config a field id belongs to. Refloat serves its own schema; VESC serves MCCONF. */
export type BoardConfigSource = 'refloat' | 'motor'

export interface ConfigRelativeField {
  source: BoardConfigSource
  /** Multiplier taking the stored value into the metric's own units (duty 0.9 → 90%). */
  scale: number
  /**
   * The stored value at or above which the board's own protection is off — VESC treats a duty
   * pushback of 1.0 as "never push back". Rules anchored to a disabled field stay dormant rather
   * than resolving to a threshold the board will never act on. `null` ⇒ no such sentinel.
   */
  disabledAtOrAbove: number | null
}

export const CONFIG_RELATIVE_FIELDS: Record<string, ConfigRelativeField> = {
  tiltback_duty: { source: 'refloat', scale: 100, disabledAtOrAbove: 1 },
  l_temp_fet_start: { source: 'motor', scale: 1, disabledAtOrAbove: null },
  l_temp_motor_start: { source: 'motor', scale: 1, disabledAtOrAbove: null },
}

/** Both configs as a reader holds them, keyed the way {@link CONFIG_RELATIVE_FIELDS} names them. */
export type BoardConfigBases = Partial<Record<BoardConfigSource, Record<string, number> | null>>

/**
 * The field's current value in the metric's units, or `null` when it cannot anchor a rule — the
 * config was never read, the field is missing from this firmware's layout, or the board has that
 * protection switched off.
 *
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/ConfigRelativeFields.kt `resolveConfigRelativeBase`
 */
export function resolveConfigRelativeBase(fieldId: string, bases: BoardConfigBases): number | null {
  const field = CONFIG_RELATIVE_FIELDS[fieldId]
  if (!field) return null
  const raw = bases[field.source]?.[fieldId]
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) return null
  if (field.disabledAtOrAbove != null && raw >= field.disabledAtOrAbove) return null
  return raw * field.scale
}
