import { createProfile, type TuneProfileFieldValue } from 'vescape-core'
import defaults from './offlineTuneDefaults.json'
import { APP_TUNE_FIELD_BY_ID } from './fields'

/** Bundled Refloat XML templates; these are never confirmed board values. */
export const OFFLINE_REFLOAT_VERSIONS = Object.keys(defaults)

export function offlineTuneFields(version: string): Record<string, TuneProfileFieldValue> {
  const template = defaults[version as keyof typeof defaults]
  if (!template) throw new Error('Choose a bundled Refloat version.')
  return Object.fromEntries(Object.entries(template).filter(([id]) => APP_TUNE_FIELD_BY_ID.has(id)))
}

export async function createOfflineTune(boardId: string, version: string) {
  return createProfile(
    boardId,
    'Main',
    'sliders-horizontal',
    'purple',
    offlineTuneFields(version),
    version,
  )
}
