import type { StoreApi } from 'zustand'
import {
  pushProfileToBoard as nativePushProfileToBoard,
  saveProfile as nativeSaveProfile,
} from 'vescape-core'

import { errorMessage } from '@/helpers/error'
import {
  canRunFirmwareCommand,
  firmwareCommandBlockedMessage,
} from '@/modules/board/lib/boardLinkIntegrity'
import { useBleStore } from '@/modules/board/store/bleStore'
import {
  boardDiff,
  sameFieldValue,
  dirtyFields,
  fieldsFromSnapshot,
  nextDraftWithField,
} from '@/modules/tune/store/tuneProfileHelpers'
import type {
  TuneProfileActions,
  TuneProfileStore,
} from '@/modules/tune/store/tuneProfileStoreTypes'
import { useTuneSnapshotStore } from '@/modules/tune/store/tuneSnapshotStore'

type TuneProfileDraftSlice = Pick<
  TuneProfileActions,
  | 'setDraftField'
  | 'setBoardSnapshot'
  | 'getDirtyFields'
  | 'revertField'
  | 'acceptBoardField'
  | 'acceptAllBoardValues'
  | 'discardAllEdits'
  | 'saveActiveProfile'
  | 'syncToBoard'
>

/** Field edits against the active profile, and pushing them to the board. */
type SliceFactory = (
  set: StoreApi<TuneProfileStore>['setState'],
  get: StoreApi<TuneProfileStore>['getState'],
) => TuneProfileDraftSlice

export const createTuneProfileDraftSlice: SliceFactory = (set, get) => ({
  setDraftField(fieldId, value) {
    set((state) => {
      if (!state.activeProfile) return state
      const savedValue = state.activeProfile.fields[fieldId]
      const draftFields = { ...state.draftFields }
      if (sameFieldValue(value, savedValue)) {
        delete draftFields[fieldId]
      } else {
        draftFields[fieldId] = value
      }
      return {
        draftFields,
        hasDirtyFields: Object.keys(dirtyFields(state.activeProfile, draftFields)).length > 0,
      }
    })
  },

  setBoardSnapshot(snapshot) {
    const boardFields = fieldsFromSnapshot(snapshot)
    set((state) => {
      const diff = boardDiff(state.activeProfile, boardFields)
      return {
        boardFields,
        refloatBaseVersion: snapshot?.refloatBaseVersion ?? state.refloatBaseVersion,
        boardDiff: diff,
        hasBoardDiff: diff.length > 0,
      }
    })
  },

  getDirtyFields() {
    const state = get()
    return dirtyFields(state.activeProfile, state.draftFields)
  },

  revertField(fieldId) {
    set((state) => {
      const draftFields = { ...state.draftFields }
      delete draftFields[fieldId]
      return {
        draftFields,
        hasDirtyFields: Object.keys(dirtyFields(state.activeProfile, draftFields)).length > 0,
      }
    })
  },

  acceptBoardField(fieldId) {
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
      )
      return {
        draftFields,
        hasDirtyFields: Object.keys(dirtyFields(state.activeProfile, draftFields)).length > 0,
      }
    })
  },

  acceptAllBoardValues() {
    set((state) => {
      const profile = state.activeProfile
      if (!profile) return state
      const draftFields = state.boardDiff.reduce(
        (next, { fieldId, boardValue }) => nextDraftWithField(profile, next, fieldId, boardValue),
        { ...state.draftFields },
      )
      return {
        draftFields,
        hasDirtyFields: Object.keys(dirtyFields(state.activeProfile, draftFields)).length > 0,
      }
    })
  },

  discardAllEdits() {
    set({ draftFields: {}, hasDirtyFields: false })
  },

  async saveActiveProfile() {
    const profile = get().activeProfile
    if (!profile) return null
    const dirty = get().getDirtyFields()
    if (Object.keys(dirty).length === 0) return profile
    set({ saving: true, error: null })
    try {
      const saved = await nativeSaveProfile(profile.id, { ...profile.fields, ...dirty })
      set((state) => {
        const diff = boardDiff(saved, state.boardFields)
        return {
          profiles: state.profiles.map((item) => (item.id === saved.id ? saved : item)),
          activeProfile: saved,
          draftFields: {},
          hasDirtyFields: false,
          boardDiff: diff,
          hasBoardDiff: diff.length > 0,
          saving: false,
          error: null,
        }
      })
      return saved
    } catch (error) {
      set({ saving: false, error: errorMessage(error, 'Unable to load tune profiles.') })
      throw error
    }
  },

  async syncToBoard() {
    const profile = get().activeProfile
    if (!profile) return
    const linkIntegrity = useBleStore.getState().linkIntegrity
    if (!canRunFirmwareCommand(linkIntegrity)) {
      set({ syncing: false, error: firmwareCommandBlockedMessage(linkIntegrity) })
      return
    }
    set({ syncing: true, error: null })
    try {
      const snapshot = await nativePushProfileToBoard(profile.id)
      useTuneSnapshotStore.getState().setSnapshot(snapshot)
      get().setBoardSnapshot(snapshot)
      set({ syncing: false })
    } catch (error) {
      set({ syncing: false, error: errorMessage(error, 'Unable to load tune profiles.') })
      throw error
    }
  },
})
