/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/ConfigRelativeFields.kt
 * @parity /modules/vescape-core/ios/alerts/ConfigRelativeFields.swift
 */

export type BoardConfigSource = 'refloat' | 'motor'

export interface ConfigRelativeField {
  source: BoardConfigSource
  scale: number
  disabledAtOrAbove: number | null
}

export const CONFIG_RELATIVE_FIELDS: Record<string, ConfigRelativeField> = {
  tiltback_duty: { source: 'refloat', scale: 100, disabledAtOrAbove: 1 },
  l_temp_fet_start: { source: 'motor', scale: 1, disabledAtOrAbove: null },
  l_temp_motor_start: { source: 'motor', scale: 1, disabledAtOrAbove: null },
}

export type BoardConfigBases = Partial<Record<BoardConfigSource, Record<string, number> | null>>

export type ConfigRelativeBase =
  | { status: 'resolved'; value: number }
  | { status: 'unread' }
  | { status: 'missing' }
  | { status: 'disabled'; value: number }

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/ConfigRelativeFields.kt `resolveConfigRelativeBase`
 */
export function configRelativeBase(fieldId: string, bases: BoardConfigBases): ConfigRelativeBase {
  const field = CONFIG_RELATIVE_FIELDS[fieldId]
  if (!field) return { status: 'missing' }
  const config = bases[field.source]
  if (config == null) return { status: 'unread' }
  const raw = config[fieldId]
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return { status: 'missing' }
  const value = raw * field.scale
  if (raw <= 0) return { status: 'disabled', value }
  if (field.disabledAtOrAbove != null && raw >= field.disabledAtOrAbove) {
    return { status: 'disabled', value }
  }
  return { status: 'resolved', value }
}

export function resolveConfigRelativeBase(fieldId: string, bases: BoardConfigBases): number | null {
  const base = configRelativeBase(fieldId, bases)
  return base.status === 'resolved' ? base.value : null
}
