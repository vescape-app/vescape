import type { BoardConfigValues, TuneProfile, TuneProfileFieldValue } from 'vescape-core'

export interface TuneProfileBoardDiff {
  fieldId: string
  profileValue: TuneProfileFieldValue | undefined
  boardValue: TuneProfileFieldValue
}

export interface PendingTuneBoardChangeset {
  profileId: string
  boardId: string
  changes: Record<string, TuneProfileFieldValue>
}

export interface TuneProfileState {
  profiles: TuneProfile[]
  activeProfile: TuneProfile | null
  activeBoardId: string | null
  refloatBaseVersion: string | null
  draftFields: Record<string, TuneProfileFieldValue>
  hasDirtyFields: boolean
  pendingBoardChangeset: PendingTuneBoardChangeset | null
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
  copyProfileToBoard: (
    profileId: string,
    targetBoardId: string,
    newName: string,
  ) => Promise<TuneProfile | null>
  setDraftField: (fieldId: string, value: TuneProfileFieldValue) => void
  setBoardConfig: (boardConfig: BoardConfigValues | null) => void
  recomputeForSchema: () => void
  getDirtyFields: () => Record<string, TuneProfileFieldValue>
  revertField: (fieldId: string) => void
  acceptBoardField: (fieldId: string) => void
  acceptAllBoardValues: () => void
  discardAllEdits: () => void
  saveActiveProfile: () => Promise<TuneProfile | null>
  saveAndSyncActiveProfile: () => Promise<void>
  retryPendingBoardSync: () => Promise<void>
  discardPendingBoardSync: () => void
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
  pendingBoardChangeset: null,
  boardFields: {},
  boardDiff: [],
  hasBoardDiff: false,
  loading: false,
  saving: false,
  syncing: false,
  error: null,
}
