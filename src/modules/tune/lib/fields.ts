import { DASH } from '@/helpers/format'
import {
  getFieldDisplayScale,
  type ResolvedBoardConfigField,
} from '@/modules/board/lib/refloatFieldOverlay'
import type { BoardConfigSchemaField } from 'vescape-core'

export function tuneDisplayScale(
  fieldId: string,
  schemaField?: Pick<BoardConfigSchemaField, 'editorScale' | 'editAsPercentage'> | null,
): number {
  return getFieldDisplayScale(fieldId, schemaField)
}

export function tuneDisplayValue(
  fieldId: string,
  value: number | boolean | string,
  displayScale?: number,
): number | boolean | string {
  const scale = displayScale ?? getFieldDisplayScale(fieldId)
  return typeof value === 'number' ? value * scale : value
}

export function formatTuneFieldValue(
  field: Pick<ResolvedBoardConfigField, 'id' | 'value' | 'displayScale' | 'enumNames'>,
): string {
  if (
    field.enumNames.length > 0 &&
    typeof field.value === 'number' &&
    Number.isInteger(field.value) &&
    field.value >= 0 &&
    field.value < field.enumNames.length
  ) {
    return field.enumNames[field.value]!
  }
  return formatTuneValue(tuneDisplayValue(field.id, field.value, field.displayScale))
}

export function formatTuneValue(value: number | boolean | string): string {
  if (typeof value === 'boolean') return value ? 'On' : 'Off'
  if (typeof value === 'string') return value
  if (!Number.isFinite(value)) return DASH
  if (Math.abs(value) >= 1000) return Math.round(value).toLocaleString()
  return Number.isInteger(value)
    ? value.toFixed(0)
    : value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
}
