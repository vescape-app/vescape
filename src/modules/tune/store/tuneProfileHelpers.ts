import { tuneCompatibilityVersion } from '@/modules/tune/lib/tuneCompatibility'
import { tuneFieldIdsFromSchema } from '@/modules/board/lib/refloatFieldOverlay'
import {
  createProfile as nativeCreateProfile,
  renameProfile as nativeRenameProfile,
  type BoardConfigSchema,
  type BoardConfigSchemaField,
  type BoardConfigValues,
  type TuneProfile,
  type TuneProfileFieldValue,
} from 'vescape-core'

import { errorMessage } from '@/helpers/error'
import {
  DEFAULT_TUNE_PROFILE_COLOR,
  DEFAULT_TUNE_PROFILE_ICON,
} from '@/modules/tune/lib/profileMetadata'
import type { TuneProfileBoardDiff } from '@/modules/tune/store/tuneProfileStoreTypes'
import { omitKey } from '@/helpers/records'

function asBool(value: TuneProfileFieldValue | undefined): boolean | null {
  if (typeof value === 'boolean') return value
  if (value === 0) return false
  if (value === 1) return true
  return null
}

function quantizeFloat32Auto(value: number): number {
  const f = Math.fround(value)
  return Math.abs(f) < 1.5e-38 ? 0 : f
}

export function schemaFieldMap(
  schema: BoardConfigSchema | null | undefined,
): ReadonlyMap<string, BoardConfigSchemaField> | undefined {
  if (!schema || schema.fields.length === 0) return undefined
  return new Map(schema.fields.map((field) => [field.id, field]))
}

function sameSchemaNumber(field: BoardConfigSchemaField, a: number, b: number): boolean {
  switch (field.type) {
    case 'int8':
    case 'uint8':
    case 'int16':
    case 'uint16':
    case 'int32':
    case 'uint32':
      return Math.floor(a + 0.5) === Math.floor(b + 0.5)
    case 'float16_scaled':
    case 'float32_scaled': {
      const scale = field.scale
      if (scale == null || !Number.isFinite(scale) || scale <= 0) {
        return Math.fround(a) === Math.fround(b)
      }
      return Math.floor(a * scale + 0.5) === Math.floor(b * scale + 0.5)
    }
    case 'float32_auto':
      return quantizeFloat32Auto(a) === quantizeFloat32Auto(b)
    case 'float32':
      return Math.fround(a) === Math.fround(b)
    case 'bool':
      return false
  }
}

export function sameFieldValue(
  fieldId: string,
  a: TuneProfileFieldValue | undefined,
  b: TuneProfileFieldValue | undefined,
  schemaFields?: ReadonlyMap<string, BoardConfigSchemaField>,
): boolean {
  if (a === b) return true
  const schemaField = schemaFields?.get(fieldId)
  if (schemaField?.type === 'bool') {
    const ba = asBool(a)
    const bb = asBool(b)
    return ba !== null && bb !== null && ba === bb
  }
  if (
    typeof a !== 'number' ||
    typeof b !== 'number' ||
    !Number.isFinite(a) ||
    !Number.isFinite(b)
  ) {
    return false
  }
  if (schemaField) return sameSchemaNumber(schemaField, a, b)
  return Math.fround(a) === Math.fround(b)
}

export function dirtyFields(
  profile: TuneProfile | null,
  draftFields: Record<string, TuneProfileFieldValue>,
  schemaFields?: ReadonlyMap<string, BoardConfigSchemaField>,
): Record<string, TuneProfileFieldValue> {
  if (!profile) return {}
  return Object.fromEntries(
    Object.entries(draftFields).filter(
      ([fieldId, value]) => !sameFieldValue(fieldId, value, profile.fields[fieldId], schemaFields),
    ),
  )
}

export function fieldsFromBoardConfig(
  boardConfig: BoardConfigValues | null,
): Record<string, TuneProfileFieldValue> {
  if (!boardConfig) return {}
  const tuneIds = tuneFieldIdsFromSchema(boardConfig.schema)
  const result: Record<string, TuneProfileFieldValue> = {}
  for (const [fieldId, value] of Object.entries(boardConfig.values)) {
    if (value === undefined) continue
    if (tuneIds.size > 0 && !tuneIds.has(fieldId)) continue
    result[fieldId] = value
  }
  return result
}

export function boardDiff(
  profile: TuneProfile | null,
  boardFields: Record<string, TuneProfileFieldValue>,
  schemaFields?: ReadonlyMap<string, BoardConfigSchemaField>,
): TuneProfileBoardDiff[] {
  if (!profile) return []
  return Object.entries(boardFields)
    .filter(
      ([fieldId, boardValue]) =>
        boardValue !== null && Object.prototype.hasOwnProperty.call(profile.fields, fieldId),
    )
    .flatMap(([fieldId, boardValue]) =>
      sameFieldValue(fieldId, profile.fields[fieldId], boardValue, schemaFields)
        ? []
        : [{ fieldId, profileValue: profile.fields[fieldId], boardValue }],
    )
}

export function nextDraftWithField(
  profile: TuneProfile,
  draftFields: Record<string, TuneProfileFieldValue>,
  fieldId: string,
  value: TuneProfileFieldValue,
  schemaFields?: ReadonlyMap<string, BoardConfigSchemaField>,
): Record<string, TuneProfileFieldValue> {
  const savedValue = profile.fields[fieldId]
  if (sameFieldValue(fieldId, value, savedValue, schemaFields)) return omitKey(draftFields, fieldId)
  return { ...draftFields, [fieldId]: value }
}

export function isCompatibleProfile(
  profile: TuneProfile,
  boardId: string | null,
  refloatBaseVersion: string | null,
): boolean {
  const compatibility = tuneCompatibilityVersion(refloatBaseVersion)
  return (
    compatibility !== null &&
    profile.boardId === boardId &&
    tuneCompatibilityVersion(profile.refloatBaseVersion) === compatibility
  )
}

export function withDefaultMetadata(profile: TuneProfile): TuneProfile {
  return {
    ...profile,
    icon: profile.icon || DEFAULT_TUNE_PROFILE_ICON,
    color: profile.color || DEFAULT_TUNE_PROFILE_COLOR,
  }
}

export function withMetadata(profile: TuneProfile, icon: string, color: string): TuneProfile {
  return {
    ...profile,
    icon: icon || DEFAULT_TUNE_PROFILE_ICON,
    color: color || DEFAULT_TUNE_PROFILE_COLOR,
  }
}

export function isLegacyTuneProfileBridgeError(error: unknown): boolean {
  const message = errorMessage(error, '').toLowerCase()
  return (
    message.includes('argument') ||
    message.includes('parameter') ||
    message.includes('expected') ||
    message.includes('cannot convert') ||
    message.includes('signature')
  )
}

export async function createNativeProfileWithMetadata(
  boardId: string,
  name: string,
  icon: string,
  color: string,
  fields: Record<string, TuneProfileFieldValue>,
  refloatBaseVersion: string,
): Promise<TuneProfile> {
  try {
    return withMetadata(
      await nativeCreateProfile(boardId, name, icon, color, fields, refloatBaseVersion),
      icon,
      color,
    )
  } catch (error) {
    if (!isLegacyTuneProfileBridgeError(error)) throw error
    const legacyCreateProfile = nativeCreateProfile as unknown as (
      boardId: string,
      name: string,
      fields: Record<string, TuneProfileFieldValue>,
    ) => Promise<TuneProfile>
    return withMetadata(await legacyCreateProfile(boardId, name, fields), icon, color)
  }
}

export async function renameNativeProfileWithMetadata(
  profileId: string,
  name: string,
  icon: string,
  color: string,
): Promise<TuneProfile> {
  try {
    return withMetadata(await nativeRenameProfile(profileId, name, icon, color), icon, color)
  } catch (error) {
    if (!isLegacyTuneProfileBridgeError(error)) throw error
    const legacyRenameProfile = nativeRenameProfile as unknown as (
      profileId: string,
      name: string,
    ) => Promise<TuneProfile>
    return withMetadata(await legacyRenameProfile(profileId, name), icon, color)
  }
}
