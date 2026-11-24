import overlayJson from '@/../modules/vescape-core/shared/refloat-field-overlay.json'
import type { BoardConfigSchema, BoardConfigSchemaField, BoardConfigValueType } from 'vescape-core'

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/config/RefloatFieldOverlay.kt `RefloatFieldRisk`
 * @parity /modules/vescape-core/ios/config/RefloatFieldOverlay.swift `RefloatFieldRisk`
 */
export type RefloatFieldRisk = 'risky' | 'internal'

export type RefloatFieldPlacement = 'primary' | 'advanced'

export interface RefloatFieldRange {
  min?: number
  max?: number
}

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/config/RefloatFieldOverlay.kt
 * @parity /modules/vescape-core/ios/config/RefloatFieldOverlay.swift
 */
export interface RefloatFieldOverlayEntry {
  label?: string
  order?: number
  softRange?: RefloatFieldRange
  hardLimit?: RefloatFieldRange
  step?: number
  manualDecimals?: number
  displayScale?: number
  placement?: RefloatFieldPlacement
  hidden?: boolean
  risk?: RefloatFieldRisk
  description?: string
}

export interface ResolvedBoardConfigField {
  id: string
  label: string
  value: number | boolean | string
  unit: string | null
  min: number | null
  max: number | null
  hardMin: number | null
  hardMax: number | null
  step: number | null
  manualDecimals: number | null
  displayScale: number
  editAsPercentage: boolean
  enumNames: string[]
  type: BoardConfigValueType
  description: string | null
  placement: RefloatFieldPlacement
  hidden: boolean
  risk: RefloatFieldRisk | null
  editable: boolean
}

export interface ResolvedBoardConfigGroup {
  id: string
  title: string
  subgroup: string
  fields: ResolvedBoardConfigField[]
}

export const TUNE_SUBGROUP_NAMES = ['Tune', 'Tune Modifiers', 'ATR'] as const

const TUNE_SUBGROUP_SET = new Set<string>(TUNE_SUBGROUP_NAMES)

const FLOAT32_MAX = 3.4028234663852886e38
const INT32_MIN = -2_147_483_648
const INT32_MAX = 2_147_483_647
const UINT32_MAX = 4_294_967_295
const INT16_MIN = -32_768
const INT16_MAX = 32_767
const UINT16_MAX = 65_535
const INT8_MIN = -128
const INT8_MAX = 127
const UINT8_MAX = 255

export const REFLOAT_FIELD_OVERLAY: Readonly<Record<string, RefloatFieldOverlayEntry>> =
  overlayJson.fields as Record<string, RefloatFieldOverlayEntry>

export function getFieldOverlay(
  fieldId: string,
  overlayMap: Readonly<Record<string, RefloatFieldOverlayEntry>> = REFLOAT_FIELD_OVERLAY,
): RefloatFieldOverlayEntry | undefined {
  return overlayMap[fieldId]
}

export function getFieldLabel(
  fieldId: string,
  schemaField?: Pick<BoardConfigSchemaField, 'label'> | null,
  overlayMap: Readonly<Record<string, RefloatFieldOverlayEntry>> = REFLOAT_FIELD_OVERLAY,
): string {
  const overlayLabel = overlayMap[fieldId]?.label
  if (overlayLabel) return overlayLabel
  const schemaLabel = schemaField?.label?.trim()
  return schemaLabel || fieldId
}

export function getFieldDisplayScale(
  fieldId: string,
  schemaField?: Pick<BoardConfigSchemaField, 'editorScale' | 'editAsPercentage'> | null,
  overlayMap: Readonly<Record<string, RefloatFieldOverlayEntry>> = REFLOAT_FIELD_OVERLAY,
): number {
  const overlayScale = overlayMap[fieldId]?.displayScale
  if (overlayScale != null && Number.isFinite(overlayScale) && overlayScale > 0) return overlayScale
  if (schemaField?.editAsPercentage) {
    const scale = schemaField.editorScale
    return scale != null && Number.isFinite(scale) && scale !== 1 && scale > 0 ? scale : 100
  }
  if (
    schemaField?.editorScale != null &&
    Number.isFinite(schemaField.editorScale) &&
    schemaField.editorScale > 0
  ) {
    return schemaField.editorScale
  }
  return 1
}

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/config/RefloatConfigEncoder.kt `effectiveRange`
 * @parity /modules/vescape-core/ios/config/RefloatConfigEncoder.swift `effectiveRange`
 */
export function wireRangeForSchemaField(
  field: Pick<BoardConfigSchemaField, 'type' | 'scale'>,
): { min: number; max: number } | null {
  switch (field.type) {
    case 'bool':
      return null
    case 'float32':
    case 'float32_auto':
      return { min: -FLOAT32_MAX, max: FLOAT32_MAX }
    case 'float32_scaled': {
      const scale = field.scale
      if (scale == null || !Number.isFinite(scale) || scale <= 0) return null
      return { min: INT32_MIN / scale, max: INT32_MAX / scale }
    }
    case 'float16_scaled': {
      const scale = field.scale
      if (scale == null || !Number.isFinite(scale) || scale <= 0) return null
      return { min: INT16_MIN / scale, max: INT16_MAX / scale }
    }
    case 'int32':
      return { min: INT32_MIN, max: INT32_MAX }
    case 'uint32':
      return { min: 0, max: UINT32_MAX }
    case 'int16':
      return { min: INT16_MIN, max: INT16_MAX }
    case 'uint16':
      return { min: 0, max: UINT16_MAX }
    case 'int8':
      return { min: INT8_MIN, max: INT8_MAX }
    case 'uint8':
      return { min: 0, max: UINT8_MAX }
  }
}

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/config/RefloatConfigEncoder.kt `effectiveRange`
 * @parity /modules/vescape-core/ios/config/RefloatConfigEncoder.swift `effectiveRange`
 */
export function effectiveHardRange(
  field: Pick<BoardConfigSchemaField, 'id' | 'type' | 'scale' | 'min' | 'max'>,
  overlay?: RefloatFieldOverlayEntry,
): { min: number; max: number } | null {
  const wire = wireRangeForSchemaField(field)
  if (!wire) return null
  let min =
    field.min != null && Number.isFinite(field.min) ? Math.max(wire.min, field.min) : wire.min
  let max =
    field.max != null && Number.isFinite(field.max) ? Math.min(wire.max, field.max) : wire.max
  const entry = overlay ?? getFieldOverlay(field.id)
  if (entry?.hardLimit?.min != null && Number.isFinite(entry.hardLimit.min)) {
    min = Math.max(min, entry.hardLimit.min)
  }
  if (entry?.hardLimit?.max != null && Number.isFinite(entry.hardLimit.max)) {
    max = Math.min(max, entry.hardLimit.max)
  }
  return { min, max }
}

function isDisplayableValue(value: unknown): value is number | boolean | string {
  return (
    (typeof value === 'number' && Number.isFinite(value)) ||
    typeof value === 'boolean' ||
    (typeof value === 'string' && value.length > 0)
  )
}

function finiteOrNull(value: number | null | undefined): number | null {
  return value != null && Number.isFinite(value) ? value : null
}

function resolveSoftBounds(
  schemaField: BoardConfigSchemaField,
  entry: RefloatFieldOverlayEntry | undefined,
  hard: { min: number; max: number } | null,
): { min: number | null; max: number | null } {
  let min =
    finiteOrNull(entry?.softRange?.min) ??
    finiteOrNull(schemaField.min) ??
    finiteOrNull(entry?.hardLimit?.min)
  let max =
    finiteOrNull(entry?.softRange?.max) ??
    finiteOrNull(schemaField.max) ??
    finiteOrNull(entry?.hardLimit?.max)
  if (hard != null) {
    if (min != null) min = Math.max(min, hard.min)
    if (max != null) max = Math.min(max, hard.max)
  }
  return { min, max }
}

function resolveRawStep(
  schemaField: BoardConfigSchemaField,
  entry: RefloatFieldOverlayEntry | undefined,
  displayScale: number,
  soft: { min: number | null; max: number | null },
): number | null {
  if (entry?.step != null) return entry.step
  const xmlStep = schemaField.step
  if (xmlStep == null || !Number.isFinite(xmlStep) || xmlStep <= 0) return null
  const isScaledDisplayStep =
    displayScale > 1 && soft.min != null && soft.max != null && xmlStep >= soft.max - soft.min
  return isScaledDisplayStep ? xmlStep / displayScale : xmlStep
}

export function resolveBoardConfigField(
  schemaField: BoardConfigSchemaField,
  value: number | boolean | string,
  overlay?: RefloatFieldOverlayEntry,
): ResolvedBoardConfigField {
  const entry = overlay ?? getFieldOverlay(schemaField.id)
  const hard = effectiveHardRange(schemaField, entry)
  const overlayLookup = entry ? { [schemaField.id]: entry } : REFLOAT_FIELD_OVERLAY
  const displayScale = getFieldDisplayScale(schemaField.id, schemaField, overlayLookup)
  const soft = resolveSoftBounds(schemaField, entry, hard)
  const risk = entry?.risk ?? null
  const unit = schemaField.unit?.trim() || (schemaField.editAsPercentage ? '%' : null)
  const defaultDecimals =
    schemaField.editAsPercentage && displayScale === 100 && schemaField.editorDecimals != null
      ? Math.max(0, schemaField.editorDecimals - 2)
      : schemaField.editorDecimals
  return {
    id: schemaField.id,
    label: entry?.label || schemaField.label || schemaField.id,
    value,
    unit,
    min: soft.min,
    max: soft.max,
    hardMin: hard?.min ?? null,
    hardMax: hard?.max ?? null,
    step: resolveRawStep(schemaField, entry, displayScale, soft),
    manualDecimals: entry?.manualDecimals ?? defaultDecimals ?? null,
    displayScale,
    editAsPercentage: schemaField.editAsPercentage,
    enumNames: schemaField.enumNames,
    type: schemaField.type,
    description: entry?.description ?? schemaField.description ?? null,
    placement: entry?.placement ?? 'primary',
    hidden: entry?.hidden ?? false,
    risk,
    editable: risk !== 'internal',
  }
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
}

function sortSectionFields(
  fields: ResolvedBoardConfigField[],
  overlayMap: Readonly<Record<string, RefloatFieldOverlayEntry>>,
): ResolvedBoardConfigField[] {
  const hasExplicitOrder = fields.some((field) => overlayMap[field.id]?.order != null)
  if (!hasExplicitOrder) return fields
  return fields
    .map((field, index) => ({ field, index, order: overlayMap[field.id]?.order }))
    .sort((a, b) => {
      if (a.order != null && b.order != null && a.order !== b.order) return a.order - b.order
      if (a.order != null && b.order == null) return -1
      if (a.order == null && b.order != null) return 1
      return a.index - b.index
    })
    .map((entry) => entry.field)
}

export function deriveTuneGroupsFromSchema(
  schema: BoardConfigSchema,
  values: Record<string, number | boolean | string | null | undefined>,
  overlayMap: Readonly<Record<string, RefloatFieldOverlayEntry>> = REFLOAT_FIELD_OVERLAY,
): ResolvedBoardConfigGroup[] {
  const schemaFieldById = new Map(schema.fields.map((field) => [field.id, field]))
  const groups: ResolvedBoardConfigGroup[] = []
  const seenFieldIds = new Set<string>()

  for (const group of schema.groups) {
    for (const subgroup of group.subgroups) {
      if (!TUNE_SUBGROUP_SET.has(subgroup.name)) continue
      let currentTitle = subgroup.name
      let currentFields: ResolvedBoardConfigField[] = []
      const flush = () => {
        if (currentFields.length === 0) return
        const id = `${slugify(subgroup.name)}:${slugify(currentTitle)}`
        groups.push({
          id,
          title: currentTitle,
          subgroup: subgroup.name,
          fields: sortSectionFields(currentFields, overlayMap),
        })
        currentFields = []
      }

      for (const item of subgroup.items) {
        if (item.kind === 'separator') {
          flush()
          currentTitle = item.title || subgroup.name
          continue
        }
        if (seenFieldIds.has(item.fieldId)) continue
        const schemaField = schemaFieldById.get(item.fieldId)
        if (!schemaField) continue
        const entry = overlayMap[schemaField.id]
        if (entry?.hidden) continue
        const rawValue = values[schemaField.id]
        const resolvedValue = isDisplayableValue(rawValue)
          ? rawValue
          : isDisplayableValue(schemaField.defaultValue)
            ? schemaField.defaultValue
            : null
        if (resolvedValue === null) continue
        seenFieldIds.add(schemaField.id)
        currentFields.push(resolveBoardConfigField(schemaField, resolvedValue, entry))
      }
      flush()
    }
  }

  return groups
}

export function tuneFieldIdsFromSchema(
  schema: BoardConfigSchema | null | undefined,
  overlayMap: Readonly<Record<string, RefloatFieldOverlayEntry>> = REFLOAT_FIELD_OVERLAY,
): Set<string> {
  const ids = new Set<string>()
  if (!schema) return ids
  const validIds = new Set(schema.fields.map((field) => field.id))
  for (const group of schema.groups) {
    for (const subgroup of group.subgroups) {
      if (!TUNE_SUBGROUP_SET.has(subgroup.name)) continue
      for (const item of subgroup.items) {
        if (item.kind !== 'field') continue
        if (!validIds.has(item.fieldId)) continue
        if (overlayMap[item.fieldId]?.hidden) continue
        ids.add(item.fieldId)
      }
    }
  }
  return ids
}

function buildFallbackField(
  id: string,
  value: number | boolean | string,
  entry: RefloatFieldOverlayEntry | undefined,
): ResolvedBoardConfigField {
  const risk = entry?.risk ?? null
  return {
    id,
    label: entry?.label || id,
    value,
    unit: null,
    min: entry?.softRange?.min ?? null,
    max: entry?.softRange?.max ?? null,
    hardMin: entry?.hardLimit?.min ?? null,
    hardMax: entry?.hardLimit?.max ?? null,
    step: entry?.step ?? null,
    manualDecimals: entry?.manualDecimals ?? null,
    displayScale: entry?.displayScale ?? 1,
    editAsPercentage: false,
    enumNames: [],
    type: typeof value === 'boolean' ? 'bool' : 'float32',
    description: entry?.description ?? null,
    placement: entry?.placement ?? 'primary',
    hidden: false,
    risk,
    editable: risk !== 'internal',
  }
}

export function deriveFallbackGroupsFromValues(
  values: Record<string, number | boolean | string | null | undefined> | null | undefined,
  overlayMap: Readonly<Record<string, RefloatFieldOverlayEntry>> = REFLOAT_FIELD_OVERLAY,
): ResolvedBoardConfigGroup[] {
  if (!values) return []
  const fields: ResolvedBoardConfigField[] = []
  for (const [id, raw] of Object.entries(values)) {
    if (!isDisplayableValue(raw)) continue
    const entry = overlayMap[id]
    if (entry?.hidden) continue
    fields.push(buildFallbackField(id, raw, entry))
  }
  if (fields.length === 0) return []
  return [
    {
      id: 'tune:saved',
      title: 'Tune',
      subgroup: 'Tune',
      fields: sortSectionFields(fields, overlayMap),
    },
  ]
}
