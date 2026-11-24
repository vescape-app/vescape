import type { BoardConfigSchema, BoardConfigSchemaField } from 'vescape-core'

import { searchItems } from '@/helpers/search'
import { boardConfigSearchKeywords } from '@/modules/board/constants/boardConfigSearchKeywords'
import type { BoardConfigGroup } from '@/modules/board/constants/boardConfigTabs'
import {
  BATTERY_CURRENT_MOTOR_CONFIG_ROWS,
  BATTERY_MOTOR_CONFIG_ROWS,
  CONTROLLER_TEMP_CONFIG_ROWS,
  DUTY_MOTOR_CONFIG_ROWS,
  MOTOR_CURRENT_MOTOR_CONFIG_ROWS,
  MOTOR_TEMP_CONFIG_ROWS,
  SPEED_MOTOR_CONFIG_ROWS,
} from '@/modules/board/constants/motorConfigRows'
import {
  resolveFieldRisk,
  isInternalBoardConfigField,
} from '@/modules/board/lib/boardConfigChangeset'
import { remainingConfigRows } from '@/modules/board/lib/remainingConfigRows'
import {
  REFLOAT_FIELD_OVERLAY,
  resolveBoardConfigField,
  TUNE_SUBGROUP_NAMES,
  type RefloatFieldOverlayEntry,
  type ResolvedBoardConfigField,
} from '@/modules/board/lib/refloatFieldOverlay'

export interface BoardConfigSchemaSection {
  id: string
  title: string
  fields: ResolvedBoardConfigField[]
}

export interface BoardConfigSchemaRefloatTab {
  id: string
  label: string
  kind: 'schema'
  readOnly: boolean
  sections: BoardConfigSchemaSection[]
}

export interface BoardConfigMotorTab {
  id: 'motor'
  label: string
  kind: 'motor'
  groups: BoardConfigGroup[]
}

export type BoardConfigSchemaTab = BoardConfigSchemaRefloatTab | BoardConfigMotorTab

export interface SchemaBoardConfigSearchResult {
  key: string
  title: string
  kind: 'schema' | 'motor'
  tabId: string
  fields?: ResolvedBoardConfigField[]
  rows?: BoardConfigGroup['rows']
}

const TUNE_SUBGROUP_SET = new Set<string>(TUNE_SUBGROUP_NAMES)

const COMMON_TAB_SECTIONS: ReadonlyArray<{
  id: string
  title: string
  fieldIds: readonly string[]
}> = [
  {
    id: 'quick:footpad-and-dismount',
    title: 'Footpad and dismount',
    fieldIds: [
      'fault_is_dual_switch',
      'enable_quickstop',
      'fault_moving_fault_disabled',
      'fault_delay_switch_half',
      'fault_delay_switch_full',
    ],
  },
  {
    id: 'quick:startup',
    title: 'Startup',
    fieldIds: [
      'startup_simplestart_enabled',
      'startup_pushstart_enabled',
      'startup_dirtylandings_enabled',
      'fault_reversestop_enabled',
    ],
  },
]

const MOTOR_CURATED_GROUPS: BoardConfigGroup[] = [
  { title: 'Motor current limits', source: 'motor', rows: MOTOR_CURRENT_MOTOR_CONFIG_ROWS },
  { title: 'Battery current limits', source: 'motor', rows: BATTERY_CURRENT_MOTOR_CONFIG_ROWS },
  { title: 'Battery voltage limits', source: 'motor', rows: BATTERY_MOTOR_CONFIG_ROWS },
  { title: 'Duty cycle limit', source: 'motor', rows: DUTY_MOTOR_CONFIG_ROWS },
  { title: 'Speed limits', source: 'motor', rows: SPEED_MOTOR_CONFIG_ROWS },
  { title: 'Controller temperature', source: 'motor', rows: CONTROLLER_TEMP_CONFIG_ROWS },
  { title: 'Motor temperature', source: 'motor', rows: MOTOR_TEMP_CONFIG_ROWS },
]

const COVERED_MOTOR_IDS = new Set(
  MOTOR_CURATED_GROUPS.flatMap((group) => group.rows.map((row) => row.id)),
)

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

function isDisplayableValue(value: unknown): value is number | boolean | string {
  return (
    (typeof value === 'number' && Number.isFinite(value)) ||
    typeof value === 'boolean' ||
    (typeof value === 'string' && value.length > 0)
  )
}

function resolveWithContext(
  schemaField: BoardConfigSchemaField,
  value: number | boolean | string,
  schema: BoardConfigSchema,
  overlayMap: Readonly<Record<string, RefloatFieldOverlayEntry>>,
  forceReadOnly: boolean,
): ResolvedBoardConfigField {
  const entry = overlayMap[schemaField.id]
  const resolved = resolveBoardConfigField(schemaField, value, entry)
  const risk = resolveFieldRisk(schemaField.id, schema, overlayMap)
  const isInternal = forceReadOnly || risk === 'internal'
  return {
    ...resolved,
    risk: isInternal ? 'internal' : risk,
    editable: !isInternal && resolved.editable,
  }
}

export function buildMotorConfigTab(
  motorValues?: Record<string, number | boolean | undefined>,
): BoardConfigMotorTab {
  const groups: BoardConfigGroup[] = MOTOR_CURATED_GROUPS.map((group) => ({
    ...group,
    rows: motorValues ? group.rows.filter((row) => motorValues[row.id] !== undefined) : group.rows,
  })).filter((group) => group.rows.length > 0)

  const extraMotorRows = remainingConfigRows(motorValues, COVERED_MOTOR_IDS)
  if (extraMotorRows.length > 0) {
    groups.push({
      title: 'Controller setup',
      source: 'motor',
      rows: extraMotorRows,
      advanced: true,
    })
  }

  return {
    id: 'motor',
    label: 'Motor',
    kind: 'motor',
    groups,
  }
}

function buildCommonTab(
  schema: BoardConfigSchema,
  schemaFieldById: ReadonlyMap<string, BoardConfigSchemaField>,
  refloatValues: Record<string, number | boolean | undefined>,
  overlayMap: Readonly<Record<string, RefloatFieldOverlayEntry>>,
): BoardConfigSchemaRefloatTab | null {
  const sections: BoardConfigSchemaSection[] = []
  for (const spec of COMMON_TAB_SECTIONS) {
    const fields: ResolvedBoardConfigField[] = []
    for (const fieldId of spec.fieldIds) {
      const schemaField = schemaFieldById.get(fieldId)
      if (!schemaField) continue
      const rawValue = refloatValues[schemaField.id]
      const value = isDisplayableValue(rawValue)
        ? rawValue
        : isDisplayableValue(schemaField.defaultValue)
          ? schemaField.defaultValue
          : null
      if (value === null) continue
      fields.push(resolveWithContext(schemaField, value, schema, overlayMap, false))
    }
    if (fields.length > 0) {
      sections.push({ id: spec.id, title: spec.title, fields })
    }
  }
  if (sections.length === 0) return null
  return { id: 'quick', label: 'Common', kind: 'schema', readOnly: false, sections }
}

export function deriveBoardConfigTabsFromSchema(
  schema: BoardConfigSchema,
  refloatValues: Record<string, number | boolean | undefined>,
  motorValues?: Record<string, number | boolean | undefined>,
  overlayMap: Readonly<Record<string, RefloatFieldOverlayEntry>> = REFLOAT_FIELD_OVERLAY,
): BoardConfigSchemaTab[] {
  const schemaFieldById = new Map(schema.fields.map((field) => [field.id, field]))
  const seenFieldIds = new Set<string>()
  const generalTabs: BoardConfigSchemaRefloatTab[] = []
  const tuneTabs: BoardConfigSchemaRefloatTab[] = []
  const internalSections: BoardConfigSchemaSection[] = []

  for (const group of schema.groups) {
    const isInternalGroup = group.name.toLowerCase() === 'internal'
    for (const subgroup of group.subgroups) {
      const isInternalSubgroup = isInternalGroup || subgroup.name.toLowerCase() === 'meta'
      const sections: BoardConfigSchemaSection[] = []
      let currentTitle = subgroup.name
      let currentFields: ResolvedBoardConfigField[] = []
      let sectionIndex = 0

      const flush = () => {
        if (currentFields.length === 0) return
        sections.push({
          id: `${slugify(subgroup.name)}:${slugify(currentTitle)}:${sectionIndex++}`,
          title: currentTitle,
          fields: currentFields,
        })
        currentFields = []
      }

      for (const item of subgroup.items) {
        if (item.kind === 'separator') {
          flush()
          currentTitle = item.title.trim() || subgroup.name
          continue
        }
        if (seenFieldIds.has(item.fieldId)) continue
        const schemaField = schemaFieldById.get(item.fieldId)
        if (!schemaField) continue
        const rawValue = refloatValues[schemaField.id]
        const value = isDisplayableValue(rawValue)
          ? rawValue
          : isDisplayableValue(schemaField.defaultValue)
            ? schemaField.defaultValue
            : null
        if (value === null) continue
        seenFieldIds.add(schemaField.id)
        currentFields.push(
          resolveWithContext(schemaField, value, schema, overlayMap, isInternalSubgroup),
        )
      }
      flush()

      if (sections.length === 0) continue

      if (isInternalSubgroup) {
        internalSections.push(...sections)
        continue
      }

      const tab: BoardConfigSchemaRefloatTab = {
        id: slugify(subgroup.name),
        label: subgroup.name,
        kind: 'schema',
        readOnly: false,
        sections,
      }
      if (TUNE_SUBGROUP_SET.has(subgroup.name)) {
        tuneTabs.push(tab)
      } else {
        generalTabs.push(tab)
      }
    }
  }

  const ungroupedFields: ResolvedBoardConfigField[] = []
  for (const schemaField of schema.fields) {
    if (seenFieldIds.has(schemaField.id)) continue
    const rawValue = refloatValues[schemaField.id]
    if (!isDisplayableValue(rawValue)) continue
    seenFieldIds.add(schemaField.id)
    const forceReadOnly = isInternalBoardConfigField(schemaField.id, schema, overlayMap)
    ungroupedFields.push(
      resolveWithContext(schemaField, rawValue, schema, overlayMap, forceReadOnly),
    )
  }

  const commonTab = buildCommonTab(schema, schemaFieldById, refloatValues, overlayMap)
  const tabs: BoardConfigSchemaTab[] = [
    ...(commonTab ? [commonTab] : []),
    ...generalTabs,
    ...tuneTabs,
  ]

  if (ungroupedFields.length > 0) {
    tabs.push({
      id: 'other',
      label: 'Other',
      kind: 'schema',
      readOnly: false,
      sections: [{ id: 'other:ungrouped', title: 'Other settings', fields: ungroupedFields }],
    })
  }

  if (internalSections.length > 0) {
    tabs.push({
      id: 'internal',
      label: 'Internal',
      kind: 'schema',
      readOnly: true,
      sections: internalSections,
    })
  }

  tabs.push(buildMotorConfigTab(motorValues))
  return tabs
}

export function searchSchemaBoardConfig(
  tabs: BoardConfigSchemaTab[],
  query: string,
  loadedSources: readonly ('refloat' | 'motor')[],
): SchemaBoardConfigSearchResult[] {
  type Entry =
    | {
        kind: 'schema'
        tab: BoardConfigSchemaRefloatTab
        section: BoardConfigSchemaSection
        field: ResolvedBoardConfigField
      }
    | {
        kind: 'motor'
        tab: BoardConfigMotorTab
        group: BoardConfigGroup
        row: BoardConfigGroup['rows'][number]
      }

  const entries: Entry[] = []
  const seen = new Set<string>()

  for (const tab of tabs) {
    if (tab.kind === 'schema') {
      if (!loadedSources.includes('refloat')) continue
      for (const section of tab.sections) {
        for (const field of section.fields) {
          const key = `refloat:${field.id}`
          if (seen.has(key)) continue
          seen.add(key)
          entries.push({ kind: 'schema', tab, section, field })
        }
      }
    } else {
      if (!loadedSources.includes('motor')) continue
      for (const group of tab.groups) {
        for (const row of group.rows) {
          const key = `motor:${row.id}`
          if (seen.has(key)) continue
          seen.add(key)
          entries.push({ kind: 'motor', tab, group, row })
        }
      }
    }
  }

  const hits = searchItems(entries, query, (entry) => {
    if (entry.kind === 'schema') {
      const keywords = boardConfigSearchKeywords('refloat', entry.field.id)
      return [
        { text: entry.field.label, weight: 10, fuzzy: true, phrase: true },
        ...keywords.map((keyword) => ({ text: keyword, weight: 8, fuzzy: true, phrase: true })),
        { text: entry.field.id, weight: 6, fuzzy: false },
        { text: `${entry.tab.label} ${entry.section.title}`, weight: 3, fuzzy: true },
        { text: entry.field.description ?? '', weight: 2, fuzzy: false },
      ]
    }
    const keywords = boardConfigSearchKeywords('motor', entry.row.id)
    return [
      { text: entry.row.label, weight: 10, fuzzy: true, phrase: true },
      ...keywords.map((keyword) => ({ text: keyword, weight: 8, fuzzy: true, phrase: true })),
      { text: entry.row.id, weight: 6, fuzzy: false },
      { text: `${entry.tab.label} ${entry.group.title}`, weight: 3, fuzzy: true },
      { text: `${entry.row.description ?? ''} ${entry.row.when ?? ''}`, weight: 2, fuzzy: false },
    ]
  })

  const grouped = new Map<string, SchemaBoardConfigSearchResult>()
  for (const { item } of hits) {
    if (item.kind === 'schema') {
      const key = `schema|${item.tab.id}|${item.section.id}`
      const existing = grouped.get(key)
      if (existing) {
        existing.fields!.push(item.field)
      } else {
        const title =
          item.section.title === item.tab.label
            ? item.tab.label
            : `${item.tab.label} · ${item.section.title}`
        grouped.set(key, {
          key,
          title,
          kind: 'schema',
          tabId: item.tab.id,
          fields: [item.field],
        })
      }
    } else {
      const key = `motor|${item.tab.id}|${item.group.title}`
      const existing = grouped.get(key)
      if (existing) {
        existing.rows!.push(item.row)
      } else {
        grouped.set(key, {
          key,
          title: `${item.tab.label} · ${item.group.title}`,
          kind: 'motor',
          tabId: item.tab.id,
          rows: [item.row],
        })
      }
    }
  }

  return [...grouped.values()]
}
