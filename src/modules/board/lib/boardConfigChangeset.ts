import type { BoardConfigSchema, BoardConfigSchemaField, BoardConfigValueType } from 'vescape-core'

import { DASH } from '@/helpers/format'
import { temperatureFromC, temperatureSymbol, type TemperatureUnit } from '@/helpers/units'
import {
  getFieldOverlay,
  REFLOAT_FIELD_OVERLAY,
  resolveBoardConfigField,
  type RefloatFieldOverlayEntry,
  type RefloatFieldRisk,
  type ResolvedBoardConfigField,
} from '@/modules/board/lib/refloatFieldOverlay'

export type BoardConfigEditorKind = 'readonly' | 'switch' | 'enum' | 'percentage' | 'number'

export type BoardConfigReviewSource = 'app' | 'revert' | 'import'

export interface BoardConfigReviewEntry {
  fieldId: string
  label: string
  oldValue: number | boolean | null
  newValue: number | boolean
  oldFormatted: string
  newFormatted: string
  risk: RefloatFieldRisk | null
  rebootNote: string | null
}

export interface BoardConfigSkippedField {
  fieldId: string
  label?: string
  reason: string
}

const INTEGER_TYPES = new Set<BoardConfigValueType>([
  'int8',
  'uint8',
  'int16',
  'uint16',
  'int32',
  'uint32',
])

const FLOAT_TOLERANCE = 1e-6

function schemaSubgroupFieldIds(
  schema: BoardConfigSchema | null | undefined,
  predicate: (groupName: string, subgroupName: string) => boolean,
): Set<string> {
  const ids = new Set<string>()
  if (!schema) return ids
  for (const group of schema.groups) {
    for (const subgroup of group.subgroups) {
      if (!predicate(group.name, subgroup.name)) continue
      for (const item of subgroup.items) {
        if (item.kind === 'field') ids.add(item.fieldId)
      }
    }
  }
  return ids
}

export function isInternalBoardConfigField(
  fieldId: string,
  schema?: BoardConfigSchema | null,
  overlayMap: Readonly<Record<string, RefloatFieldOverlayEntry>> = REFLOAT_FIELD_OVERLAY,
): boolean {
  if (overlayMap[fieldId]?.risk === 'internal') return true
  if (fieldId.startsWith('meta.')) return true
  const internalIds = schemaSubgroupFieldIds(
    schema,
    (groupName, subgroupName) =>
      groupName.toLowerCase() === 'internal' || subgroupName.toLowerCase() === 'meta',
  )
  return internalIds.has(fieldId)
}

export function isRiskyBoardConfigField(
  fieldId: string,
  schema?: BoardConfigSchema | null,
  overlayMap: Readonly<Record<string, RefloatFieldOverlayEntry>> = REFLOAT_FIELD_OVERLAY,
): boolean {
  if (isInternalBoardConfigField(fieldId, schema, overlayMap)) return false
  if (fieldId.startsWith('hardware.leds.')) return false
  if (overlayMap[fieldId]?.risk === 'risky') return true
  if (
    fieldId === 'disabled' ||
    fieldId === 'inputtilt_remote_type' ||
    fieldId.startsWith('fault_adc') ||
    fieldId.startsWith('fault_delay_')
  ) {
    return true
  }
  const specsIds = schemaSubgroupFieldIds(
    schema,
    (_groupName, subgroupName) => subgroupName.toLowerCase() === 'specs',
  )
  return specsIds.has(fieldId)
}

export function resolveFieldRisk(
  fieldId: string,
  schema?: BoardConfigSchema | null,
  overlayMap: Readonly<Record<string, RefloatFieldOverlayEntry>> = REFLOAT_FIELD_OVERLAY,
): RefloatFieldRisk | null {
  if (isInternalBoardConfigField(fieldId, schema, overlayMap)) return 'internal'
  if (isRiskyBoardConfigField(fieldId, schema, overlayMap)) return 'risky'
  return null
}

function isRefloatVersionAtLeast12(version: string | null | undefined): boolean {
  if (!version) return true
  const match = version.trim().match(/^(\d+)\.(\d+)/)
  if (!match) return true
  const major = Number(match[1])
  const minor = Number(match[2])
  return major > 1 || (major === 1 && minor >= 2)
}

export function getBoardConfigRebootNote(
  fieldId: string,
  refloatBaseVersion?: string | null,
): string | null {
  if (fieldId.startsWith('hardware.leds.')) {
    return 'Requires a board reboot to take effect.'
  }
  if (fieldId === 'leds.on' && isRefloatVersionAtLeast12(refloatBaseVersion)) {
    return 'Requires a board reboot if lights were toggled via Light Control (Refloat 1.2+).'
  }
  return null
}

export function resolveBoardConfigEditorKind(
  field: Pick<
    ResolvedBoardConfigField,
    'editable' | 'risk' | 'type' | 'enumNames' | 'editAsPercentage' | 'displayScale' | 'unit'
  >,
): BoardConfigEditorKind {
  if (!field.editable || field.risk === 'internal') return 'readonly'
  if (field.type === 'bool') return 'switch'
  if (field.enumNames.length > 0) return 'enum'
  if (field.editAsPercentage || (field.displayScale === 100 && field.unit === '%')) {
    return 'percentage'
  }
  return 'number'
}

export function isIntegerFieldType(type: BoardConfigValueType): boolean {
  return INTEGER_TYPES.has(type)
}

export function decimalsForField(
  field: Pick<ResolvedBoardConfigField, 'type' | 'manualDecimals' | 'step' | 'displayScale'>,
): number {
  if (field.manualDecimals != null && Number.isFinite(field.manualDecimals)) {
    return Math.max(0, Math.min(6, Math.round(field.manualDecimals)))
  }
  if (isIntegerFieldType(field.type)) return 0
  if (field.step != null && field.step > 0) {
    const displayStep = field.step * field.displayScale
    const text = displayStep.toFixed(6).replace(/0+$/, '')
    const dot = text.indexOf('.')
    if (dot === -1 || dot === text.length - 1) return 0
    return Math.min(4, text.length - dot - 1)
  }
  return 2
}

export function formatNumericDisplay(value: number, decimals: number): string {
  if (!Number.isFinite(value)) return DASH
  const rounded = Number(value.toFixed(decimals))
  const normalized = Object.is(rounded, -0) ? 0 : rounded
  if (decimals === 0) return String(Math.round(normalized))
  return normalized.toFixed(decimals).replace(/\.?0+$/, '')
}

export function formatBoardConfigFieldValue(
  field: Pick<
    ResolvedBoardConfigField,
    'type' | 'enumNames' | 'unit' | 'displayScale' | 'manualDecimals' | 'step'
  >,
  value: number | boolean | string | null | undefined,
  temperatureUnit: TemperatureUnit = 'celsius',
): string {
  if (value === null || value === undefined) return DASH
  if (typeof value === 'string') return value
  if (field.type === 'bool' || typeof value === 'boolean') {
    const enabled = typeof value === 'boolean' ? value : value !== 0
    return enabled ? 'On' : 'Off'
  }
  if (field.enumNames.length > 0) {
    const index = Math.round(value)
    return field.enumNames[index] ?? `Unknown (${index})`
  }
  if (field.unit === '°C') {
    const converted = temperatureFromC(value, temperatureUnit)
    const decimals = decimalsForField(field)
    return `${formatNumericDisplay(converted, decimals)} ${temperatureSymbol(temperatureUnit)}`
  }
  const scaled = value * field.displayScale
  const decimals = decimalsForField(field)
  const formatted = formatNumericDisplay(scaled, decimals)
  if (!field.unit) return formatted
  const separator = field.unit === '%' || field.unit === '°' ? '' : ' '
  return `${formatted}${separator}${field.unit}`
}

export function clampBoardConfigFieldValue(
  field: Pick<ResolvedBoardConfigField, 'type' | 'hardMin' | 'hardMax'>,
  rawValue: number,
): number {
  let next = rawValue
  if (field.hardMin != null && next < field.hardMin) next = field.hardMin
  if (field.hardMax != null && next > field.hardMax) next = field.hardMax
  if (isIntegerFieldType(field.type)) next = Math.round(next)
  return Object.is(next, -0) ? 0 : next
}

export function stepForBoardConfigField(
  field: Pick<ResolvedBoardConfigField, 'type' | 'step' | 'displayScale'>,
): number {
  if (field.step != null && Number.isFinite(field.step) && field.step > 0) {
    return field.step
  }
  if (isIntegerFieldType(field.type)) return 1
  return field.displayScale > 1 ? 1 / field.displayScale : 0.1
}

export function hasPendingBoardConfigChange(
  currentValue: number | boolean | undefined,
  nextValue: number | boolean,
): boolean {
  if (currentValue === undefined) return true
  if (typeof currentValue === 'boolean' || typeof nextValue === 'boolean') {
    const currentBool = typeof currentValue === 'boolean' ? currentValue : currentValue !== 0
    const nextBool = typeof nextValue === 'boolean' ? nextValue : nextValue !== 0
    return currentBool !== nextBool
  }
  return Math.abs(currentValue - nextValue) > FLOAT_TOLERANCE
}

export function buildBoardConfigReviewEntries({
  changes,
  currentValues,
  schema,
  refloatBaseVersion,
  temperatureUnit = 'celsius',
  overlayMap = REFLOAT_FIELD_OVERLAY,
}: {
  changes: Readonly<Record<string, number | boolean>>
  currentValues: Readonly<Record<string, number | boolean | undefined>>
  schema?: BoardConfigSchema | null
  refloatBaseVersion?: string | null
  temperatureUnit?: TemperatureUnit
  overlayMap?: Readonly<Record<string, RefloatFieldOverlayEntry>>
}): BoardConfigReviewEntry[] {
  const schemaFieldById = new Map<string, BoardConfigSchemaField>(
    (schema?.fields ?? []).map((field) => [field.id, field]),
  )

  return Object.entries(changes).map(([fieldId, newValue]) => {
    const rawOld = currentValues[fieldId]
    const oldValue = rawOld === undefined ? null : rawOld
    const schemaField = schemaFieldById.get(fieldId)
    const entry = getFieldOverlay(fieldId, overlayMap)
    const risk = resolveFieldRisk(fieldId, schema, overlayMap)

    const resolvedField: Pick<
      ResolvedBoardConfigField,
      'label' | 'type' | 'enumNames' | 'unit' | 'displayScale' | 'manualDecimals' | 'step'
    > = schemaField
      ? resolveBoardConfigField(schemaField, newValue, entry)
      : {
          label: entry?.label || fieldId,
          type: typeof newValue === 'boolean' ? 'bool' : 'float32',
          enumNames: [],
          unit: null,
          displayScale: entry?.displayScale ?? 1,
          manualDecimals: entry?.manualDecimals ?? null,
          step: entry?.step ?? null,
        }

    return {
      fieldId,
      label: resolvedField.label,
      oldValue,
      newValue,
      oldFormatted: formatBoardConfigFieldValue(resolvedField, oldValue, temperatureUnit),
      newFormatted: formatBoardConfigFieldValue(resolvedField, newValue, temperatureUnit),
      risk,
      rebootNote: getBoardConfigRebootNote(fieldId, refloatBaseVersion),
    }
  })
}
