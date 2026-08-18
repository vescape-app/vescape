import {
  createProfile as nativeCreateProfile,
  renameProfile as nativeRenameProfile,
  type RefloatConfigSnapshot,
  type TuneProfile,
  type TuneProfileFieldValue,
} from 'vescape-core'

import { errorMessage } from '@/helpers/error'
import { formatTuneValue } from '@/modules/tune/lib/fields'
import {
  DEFAULT_TUNE_PROFILE_COLOR,
  DEFAULT_TUNE_PROFILE_ICON,
} from '@/modules/tune/lib/profileMetadata'
import type { TuneProfileBoardDiff } from '@/modules/tune/store/tuneProfileStoreTypes'
import { omitKey } from '@/helpers/records'

export function sameFieldValue(
  a: TuneProfileFieldValue | undefined,
  b: TuneProfileFieldValue | undefined,
): boolean {
  if (a === b) return true
  if (typeof a === 'number' && typeof b === 'number') {
    return formatTuneValue(a) === formatTuneValue(b)
  }
  return false
}

export function dirtyFields(
  profile: TuneProfile | null,
  draftFields: Record<string, TuneProfileFieldValue>,
): Record<string, TuneProfileFieldValue> {
  if (!profile) return {}
  return Object.fromEntries(
    Object.entries(draftFields).filter(
      ([fieldId, value]) => !sameFieldValue(value, profile.fields[fieldId]),
    ),
  )
}

export function fieldsFromSnapshot(
  snapshot: RefloatConfigSnapshot | null,
): Record<string, TuneProfileFieldValue> {
  if (!snapshot) return {}
  return Object.fromEntries(
    snapshot.groups.flatMap((group) =>
      group.fields.map((field) => [field.id, field.value as TuneProfileFieldValue]),
    ),
  )
}

export function boardDiff(
  profile: TuneProfile | null,
  boardFields: Record<string, TuneProfileFieldValue>,
): TuneProfileBoardDiff[] {
  if (!profile) return []
  return Object.entries(boardFields)
    .filter(
      ([fieldId, boardValue]) =>
        boardValue !== null && Object.prototype.hasOwnProperty.call(profile.fields, fieldId),
    )
    .flatMap(([fieldId, boardValue]) =>
      sameFieldValue(profile.fields[fieldId], boardValue)
        ? []
        : [{ fieldId, profileValue: profile.fields[fieldId], boardValue }],
    )
}

export function nextDraftWithField(
  profile: TuneProfile,
  draftFields: Record<string, TuneProfileFieldValue>,
  fieldId: string,
  value: TuneProfileFieldValue,
): Record<string, TuneProfileFieldValue> {
  const savedValue = profile.fields[fieldId]
  if (sameFieldValue(value, savedValue)) return omitKey(draftFields, fieldId)
  return { ...draftFields, [fieldId]: value }
}

export function isCompatibleProfile(
  profile: TuneProfile,
  boardId: string | null,
  refloatBaseVersion: string | null,
): boolean {
  return profile.boardId === boardId && profile.refloatBaseVersion === refloatBaseVersion
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
