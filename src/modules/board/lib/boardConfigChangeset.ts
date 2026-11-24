import type { BoardConfigSchema, BoardConfigSchemaField, BoardConfigValueType } from 'vescape-core'

import { DASH } from '@/helpers/format'
import {
  temperatureFromC,
  temperatureSymbol,
  temperatureToC,
  type TemperatureUnit,
} from '@/helpers/units'
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
  decimalsOverride?: number,
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
  const decimals = decimalsOverride ?? decimalsForField(field)
  if (field.unit === '°C') {
    const converted = temperatureFromC(value, temperatureUnit)
    return `${formatNumericDisplay(converted, decimals)} ${temperatureSymbol(temperatureUnit)}`
  }
  const scaled = value * field.displayScale
  const formatted = formatNumericDisplay(scaled, decimals)
  if (!field.unit) return formatted
  const separator = field.unit === '%' || field.unit === '°' ? '' : ' '
  return `${formatted}${separator}${field.unit}`
}

export function isTemperatureBoardConfigField(
  field: Pick<ResolvedBoardConfigField, 'unit'>,
): boolean {
  return field.unit === '°C'
}

export function toBoardConfigDisplayValue(
  field: Pick<ResolvedBoardConfigField, 'unit' | 'displayScale'>,
  rawValue: number,
  temperatureUnit: TemperatureUnit = 'celsius',
): number {
  if (isTemperatureBoardConfigField(field)) {
    return temperatureFromC(rawValue, temperatureUnit)
  }
  return rawValue * field.displayScale
}

export function boardConfigDisplayUnit(
  field: Pick<ResolvedBoardConfigField, 'unit'>,
  editorKind: BoardConfigEditorKind,
  temperatureUnit: TemperatureUnit = 'celsius',
): string | null {
  if (editorKind === 'percentage') return '%'
  if (isTemperatureBoardConfigField(field)) return temperatureSymbol(temperatureUnit)
  return field.unit
}

export function parseBoardConfigDraftInput(
  field: Pick<ResolvedBoardConfigField, 'type' | 'unit' | 'displayScale' | 'hardMin' | 'hardMax'>,
  draftText: string,
  temperatureUnit: TemperatureUnit = 'celsius',
): number | null {
  const trimmed = draftText.replace(',', '.').trim()
  if (trimmed === '') return null
  const parsed = Number(trimmed)
  if (!Number.isFinite(parsed)) return null
  const rawNext = isTemperatureBoardConfigField(field)
    ? Number(temperatureToC(parsed, temperatureUnit).toFixed(6))
    : field.displayScale > 0
      ? parsed / field.displayScale
      : parsed
  return clampBoardConfigFieldValue(field, rawNext)
}

export function stepBoardConfigNumericValue(
  field: Pick<
    ResolvedBoardConfigField,
    'type' | 'unit' | 'step' | 'displayScale' | 'hardMin' | 'hardMax'
  >,
  currentRawValue: number,
  direction: 1 | -1,
  temperatureUnit: TemperatureUnit = 'celsius',
): number {
  const rawStep = stepForBoardConfigField(field)
  if (isTemperatureBoardConfigField(field) && temperatureUnit === 'fahrenheit') {
    const nextDisplay = temperatureFromC(currentRawValue, temperatureUnit) + direction * rawStep
    const nextRaw = Number(temperatureToC(nextDisplay, temperatureUnit).toFixed(6))
    return clampBoardConfigFieldValue(field, nextRaw)
  }
  const nextRaw = Number((currentRawValue + direction * rawStep).toFixed(6))
  return clampBoardConfigFieldValue(field, nextRaw)
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

function wireMaxDecimals(
  field: Pick<
    ResolvedBoardConfigField,
    'type' | 'unit' | 'displayScale' | 'manualDecimals' | 'step'
  >,
  schemaField: BoardConfigSchemaField | undefined,
  temperatureUnit: TemperatureUnit,
): number {
  const baseDecimals = decimalsForField(field)
  if (isIntegerFieldType(field.type)) {
    return isTemperatureBoardConfigField(field) && temperatureUnit === 'fahrenheit'
      ? Math.max(baseDecimals, 1)
      : baseDecimals
  }
  if (schemaField?.scale != null && Number.isFinite(schemaField.scale) && schemaField.scale > 0) {
    const effectiveScale = schemaField.scale / Math.max(1, field.displayScale)
    const wireDecimals = effectiveScale > 1 ? Math.ceil(Math.log10(effectiveScale)) : 0
    const withTemp =
      isTemperatureBoardConfigField(field) && temperatureUnit === 'fahrenheit'
        ? wireDecimals + 1
        : wireDecimals
    return Math.min(6, Math.max(baseDecimals, withTemp))
  }
  return Math.max(baseDecimals, 6)
}

function formatReviewValuePair(
  field: Pick<
    ResolvedBoardConfigField,
    'type' | 'enumNames' | 'unit' | 'displayScale' | 'manualDecimals' | 'step'
  >,
  schemaField: BoardConfigSchemaField | undefined,
  oldValue: number | boolean | null,
  newValue: number | boolean,
  temperatureUnit: TemperatureUnit,
): { oldFormatted: string; newFormatted: string } {
  const oldFormatted = formatBoardConfigFieldValue(field, oldValue, temperatureUnit)
  const newFormatted = formatBoardConfigFieldValue(field, newValue, temperatureUnit)
  if (
    typeof oldValue !== 'number' ||
    typeof newValue !== 'number' ||
    Math.abs(oldValue - newValue) <= FLOAT_TOLERANCE ||
    oldFormatted !== newFormatted ||
    field.enumNames.length > 0 ||
    field.type === 'bool'
  ) {
    return { oldFormatted, newFormatted }
  }
  const baseDecimals = decimalsForField(field)
  const maxDecimals = wireMaxDecimals(field, schemaField, temperatureUnit)
  for (let decimals = baseDecimals + 1; decimals <= maxDecimals; decimals += 1) {
    const nextOld = formatBoardConfigFieldValue(field, oldValue, temperatureUnit, decimals)
    const nextNew = formatBoardConfigFieldValue(field, newValue, temperatureUnit, decimals)
    if (nextOld !== nextNew) {
      return { oldFormatted: nextOld, newFormatted: nextNew }
    }
  }
  return { oldFormatted, newFormatted }
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

    const { oldFormatted, newFormatted } = formatReviewValuePair(
      resolvedField,
      schemaField,
      oldValue,
      newValue,
      temperatureUnit,
    )

    return {
      fieldId,
      label: resolvedField.label,
      oldValue,
      newValue,
      oldFormatted,
      newFormatted,
      risk,
      rebootNote: getBoardConfigRebootNote(fieldId, refloatBaseVersion),
    }
  })
}

export interface BoardConfigFieldInfo {
  title: string
  message: string
  variant: 'info' | 'warning'
}

function defaultRiskReason(fieldId: string): string {
  if (fieldId.startsWith('fault_adc')) {
    return 'Affects footpad sensor detection. Wrong values can cause cutouts while riding or keep the board running after you step off.'
  }
  if (fieldId.startsWith('fault_delay_')) {
    return 'Controls how quickly the board cuts power during a fault or bail. Double-check the timing before riding.'
  }
  return 'Affects cutoffs, hardware specs, or board safety. Double-check the value before writing.'
}

export function buildBoardConfigFieldInfo(
  field: Pick<
    ResolvedBoardConfigField,
    'id' | 'label' | 'description' | 'when' | 'recommended' | 'risk' | 'riskReason'
  >,
  refloatBaseVersion?: string | null,
): BoardConfigFieldInfo | null {
  const parts: string[] = []
  const description = field.description?.trim()
  if (description) parts.push(description)
  if (field.recommended) {
    parts.push(`Recommended: ${field.recommended === 'on' ? 'On' : 'Off'}.`)
  }
  const when = field.when?.trim()
  if (when) parts.push(`When to use: ${when}`)
  if (field.risk === 'risky') {
    parts.push(`Safety-sensitive: ${field.riskReason?.trim() || defaultRiskReason(field.id)}`)
  } else if (field.risk === 'internal') {
    parts.push('Internal Refloat metadata managed by the firmware. Read-only.')
  }
  const rebootNote = getBoardConfigRebootNote(field.id, refloatBaseVersion)
  if (rebootNote) parts.push(rebootNote)
  if (parts.length === 0) return null
  return {
    title: field.label,
    message: parts.join('\n\n'),
    variant: field.risk === 'risky' ? 'warning' : 'info',
  }
}
