import type { StoreApi } from 'zustand'
import {
  applyBoardConfigChangeset as nativeApplyBoardConfigChangeset,
  pushProfileToBoard as nativePushProfileToBoard,
  saveProfile as nativeSaveProfile,
  type BoardConfigValues,
} from 'vescape-core'

import { errorMessage } from '@/helpers/error'
import { tuneWriteErrorMessage } from '@/modules/tune/lib/tuneWriteErrors'
import {
  canRunFirmwareCommand,
  firmwareCommandBlockedMessage,
} from '@/modules/board/lib/boardLinkIntegrity'
import { useBleStore } from '@/modules/board/store/bleStore'
import { useBoardConfigValuesStore } from '@/modules/board/store/boardConfigValuesStore'
import {
  boardDiff,
  sameFieldValue,
  dirtyFields,
  fieldsFromBoardConfig,
  nextDraftWithField,
  schemaFieldMap,
} from '@/modules/tune/store/tuneProfileHelpers'
import type {
  TuneProfileActions,
  TuneProfileStore,
} from '@/modules/tune/store/tuneProfileStoreTypes'
import { useTuneSnapshotStore } from '@/modules/tune/store/tuneSnapshotStore'
import { omitKey } from '@/helpers/records'

type TuneProfileDraftSlice = Pick<
  TuneProfileActions,
  | 'setDraftField'
  | 'setBoardConfig'
  | 'recomputeForSchema'
  | 'getDirtyFields'
  | 'revertField'
  | 'acceptBoardField'
  | 'acceptAllBoardValues'
  | 'discardAllEdits'
  | 'saveActiveProfile'
  | 'saveAndSyncActiveProfile'
  | 'retryPendingBoardSync'
  | 'discardPendingBoardSync'
  | 'syncToBoard'
>

type SliceFactory = (
  set: StoreApi<TuneProfileStore>['setState'],
  get: StoreApi<TuneProfileStore>['getState'],
) => TuneProfileDraftSlice

export const createTuneProfileDraftSlice: SliceFactory = (set, get) => {
  function activeSchemaFields(boardConfig?: BoardConfigValues | null) {
    const storeState = useBoardConfigValuesStore.getState()
    const schema =
      boardConfig?.schema ?? storeState.values?.schema ?? storeState.lastKnown?.schema ?? null
    return schemaFieldMap(schema)
  }

  async function runBoardWrite(write: () => Promise<BoardConfigValues>): Promise<boolean> {
    const linkIntegrity = useBleStore.getState().linkIntegrity
    if (!canRunFirmwareCommand(linkIntegrity)) {
      set({ syncing: false, error: firmwareCommandBlockedMessage(linkIntegrity) })
      return false
    }
    set({ syncing: true, error: null })
    try {
      const boardConfig = await write()
      useBoardConfigValuesStore.getState().replace(boardConfig)
      useTuneSnapshotStore.getState().setBoardConfig(boardConfig)
      get().setBoardConfig(boardConfig)
      set({ syncing: false })
      return true
    } catch (error) {
      set({ syncing: false, error: tuneWriteErrorMessage(error) })
      throw error
    }
  }

  return {
    setDraftField(fieldId, value) {
      const schemaFields = activeSchemaFields()
      set((state) => {
        if (!state.activeProfile) return state
        const savedValue = state.activeProfile.fields[fieldId]
        const draftFields = sameFieldValue(fieldId, value, savedValue, schemaFields)
          ? omitKey(state.draftFields, fieldId)
          : { ...state.draftFields, [fieldId]: value }
        return {
          draftFields,
          hasDirtyFields:
            Object.keys(dirtyFields(state.activeProfile, draftFields, schemaFields)).length > 0,
        }
      })
    },

    setBoardConfig(boardConfig) {
      const boardFields = fieldsFromBoardConfig(boardConfig)
      const schemaFields = activeSchemaFields(boardConfig)
      set((state) => {
        const diff = boardDiff(state.activeProfile, boardFields, schemaFields)
        return {
          boardFields,
          refloatBaseVersion: boardConfig?.refloatBaseVersion ?? state.refloatBaseVersion,
          boardDiff: diff,
          hasBoardDiff: diff.length > 0,
          hasDirtyFields:
            Object.keys(dirtyFields(state.activeProfile, state.draftFields, schemaFields)).length >
            0,
        }
      })
    },

    recomputeForSchema() {
      const schemaFields = activeSchemaFields()
      set((state) => {
        const diff = boardDiff(state.activeProfile, state.boardFields, schemaFields)
        return {
          boardDiff: diff,
          hasBoardDiff: diff.length > 0,
          hasDirtyFields:
            Object.keys(dirtyFields(state.activeProfile, state.draftFields, schemaFields)).length >
            0,
        }
      })
    },

    getDirtyFields() {
      const state = get()
      return dirtyFields(state.activeProfile, state.draftFields, activeSchemaFields())
    },

    revertField(fieldId) {
      const schemaFields = activeSchemaFields()
      set((state) => {
        const draftFields = omitKey(state.draftFields, fieldId)
        return {
          draftFields,
          hasDirtyFields:
            Object.keys(dirtyFields(state.activeProfile, draftFields, schemaFields)).length > 0,
        }
      })
    },

    acceptBoardField(fieldId) {
      const schemaFields = activeSchemaFields()
      set((state) => {
        if (
          !state.activeProfile ||
          !Object.prototype.hasOwnProperty.call(state.boardFields, fieldId)
        ) {
          return state
        }
        const draftFields = nextDraftWithField(
          state.activeProfile,
          state.draftFields,
          fieldId,
          state.boardFields[fieldId],
          schemaFields,
        )
        return {
          draftFields,
          hasDirtyFields:
            Object.keys(dirtyFields(state.activeProfile, draftFields, schemaFields)).length > 0,
        }
      })
    },

    acceptAllBoardValues() {
      const schemaFields = activeSchemaFields()
      set((state) => {
        const profile = state.activeProfile
        if (!profile) return state
        const draftFields = state.boardDiff.reduce(
          (next, { fieldId, boardValue }) =>
            nextDraftWithField(profile, next, fieldId, boardValue, schemaFields),
          { ...state.draftFields },
        )
        return {
          draftFields,
          hasDirtyFields:
            Object.keys(dirtyFields(state.activeProfile, draftFields, schemaFields)).length > 0,
        }
      })
    },

    discardAllEdits() {
      set({ draftFields: {}, hasDirtyFields: false, pendingBoardChangeset: null })
    },

    async saveActiveProfile() {
      const profile = get().activeProfile
      if (!profile) return null
      const dirty = get().getDirtyFields()
      if (Object.keys(dirty).length === 0) return profile
      set({ saving: true, error: null })
      try {
        const saved = await nativeSaveProfile(profile.id, { ...profile.fields, ...dirty })
        const schemaFields = activeSchemaFields()
        set((state) => {
          if (state.activeProfile?.id !== profile.id) return { saving: false }
          const remainingDraft = Object.fromEntries(
            Object.entries(state.draftFields).filter(
              ([fieldId, value]) => !(fieldId in dirty) || dirty[fieldId] !== value,
            ),
          )
          const diff = boardDiff(saved, state.boardFields, schemaFields)
          return {
            profiles: state.profiles.map((item) => (item.id === saved.id ? saved : item)),
            activeProfile: saved,
            draftFields: remainingDraft,
            hasDirtyFields:
              Object.keys(dirtyFields(saved, remainingDraft, schemaFields)).length > 0,
            boardDiff: diff,
            hasBoardDiff: diff.length > 0,
            saving: false,
            error: null,
          }
        })
        return saved
      } catch (error) {
        set({ saving: false, error: errorMessage(error, 'Unable to save tune profile.') })
        throw error
      }
    },

    async saveAndSyncActiveProfile() {
      const profile = get().activeProfile
      if (!profile) return
      const dirty = get().getDirtyFields()
      const existingPending =
        get().pendingBoardChangeset?.profileId === profile.id
          ? get().pendingBoardChangeset!.changes
          : {}
      const changeset = { ...existingPending, ...dirty }
      const saved = Object.keys(dirty).length > 0 ? await get().saveActiveProfile() : profile
      if (!saved || Object.keys(changeset).length === 0) return
      set({
        pendingBoardChangeset: {
          profileId: saved.id,
          boardId: saved.boardId,
          changes: changeset,
        },
      })
      const synced = await runBoardWrite(() =>
        nativeApplyBoardConfigChangeset(saved.boardId, changeset),
      )
      if (synced) {
        set((state) =>
          state.pendingBoardChangeset?.profileId === saved.id
            ? { pendingBoardChangeset: null }
            : state,
        )
      }
    },

    async retryPendingBoardSync() {
      const pending = get().pendingBoardChangeset
      if (!pending) return
      const synced = await runBoardWrite(() =>
        nativeApplyBoardConfigChangeset(pending.boardId, pending.changes),
      )
      if (synced) {
        set((state) =>
          state.pendingBoardChangeset?.profileId === pending.profileId
            ? { pendingBoardChangeset: null }
            : state,
        )
      }
    },

    discardPendingBoardSync() {
      set({ pendingBoardChangeset: null, error: null })
    },

    async syncToBoard() {
      const profile = get().activeProfile
      if (!profile || get().boardDiff.length === 0) return
      const synced = await runBoardWrite(() => nativePushProfileToBoard(profile.id))
      if (synced) {
        set((state) =>
          state.pendingBoardChangeset?.profileId === profile.id
            ? { pendingBoardChangeset: null }
            : state,
        )
      }
    },
  }
}
