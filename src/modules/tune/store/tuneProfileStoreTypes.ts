import type { TuneHistoryEntry, TuneProfile, TuneProfileFieldValue } from 'vescape-core'

import type { TuneBoardValues } from '@/modules/tune/lib/boardConfigPrefill'

export interface TuneProfileBoardDiff {
  fieldId: string
  profileValue: TuneProfileFieldValue | undefined
  boardValue: TuneProfileFieldValue
}

export interface TuneProfileState {
  profiles: TuneProfile[]
  activeProfile: TuneProfile | null
  activeBoardId: string | null
  refloatBaseVersion: string | null
  draftFields: Record<string, TuneProfileFieldValue>
  hasDirtyFields: boolean
  boardFields: Record<string, TuneProfileFieldValue>
  boardDiff: TuneProfileBoardDiff[]
  hasBoardDiff: boolean
  loading: boolean
  saving: boolean
  syncing: boolean
  error: string | null
}

export interface TuneProfileActions {
  loadProfiles: (boardId: string, refloatBaseVersion: string | null) => Promise<TuneProfile[]>
  loadProfile: (profileId: string) => Promise<TuneProfile | null>
  setActiveProfile: (profileId: string) => void
  createProfile: (
    name: string,
    icon: string,
    color: string,
    cloneFromProfileId?: string,
  ) => Promise<TuneProfile | null>
  renameProfile: (
    profileId: string,
    name: string,
    icon: string,
    color: string,
  ) => Promise<TuneProfile | null>
  deleteProfile: (profileId: string) => Promise<void>
  loadHistory: (profileId: string) => Promise<TuneHistoryEntry[]>
  rollbackToHistory: (historyEntryId: number) => Promise<TuneProfile | null>
  copyProfileToBoard: (
    profileId: string,
    targetBoardId: string,
    newName: string,
  ) => Promise<TuneProfile | null>
  setDraftField: (fieldId: string, value: TuneProfileFieldValue) => void
  setBoardSnapshot: (boardValues: TuneBoardValues | null) => void
  getDirtyFields: () => Record<string, TuneProfileFieldValue>
  revertField: (fieldId: string) => void
  acceptBoardField: (fieldId: string) => void
  acceptAllBoardValues: () => void
  discardAllEdits: () => void
  saveActiveProfile: () => Promise<TuneProfile | null>
  syncToBoard: () => Promise<void>
  clear: () => void
}

export type TuneProfileStore = TuneProfileState & TuneProfileActions

export const INITIAL_TUNE_PROFILE_STATE: TuneProfileState = {
  profiles: [],
  activeProfile: null,
  activeBoardId: null,
  refloatBaseVersion: null,
  draftFields: {},
  hasDirtyFields: false,
  boardFields: {},
  boardDiff: [],
  hasBoardDiff: false,
  loading: false,
  saving: false,
  syncing: false,
  error: null,
}
