import type { StoreApi } from 'zustand'
import {
  pushProfileToBoard as nativePushProfileToBoard,
  sendTuneDraftToBoard as nativeSendTuneDraftToBoard,
  saveProfile as nativeSaveProfile,
} from 'vescape-core'

import { errorMessage } from '@/helpers/error'
import {
  canRunFirmwareCommand,
  firmwareCommandBlockedMessage,
} from '@/modules/board/lib/boardLinkIntegrity'
import { useBleStore } from '@/modules/board/store/bleStore'
import {
  isCompatibleProfile,
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
import { omitKey } from '@/helpers/records'

type TuneProfileDraftSlice = Pick<
  TuneProfileActions,
  | 'setDraftFields'
  | 'readBoardToDraft'
  | 'sendDraftToBoard'
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
  setDraftFields(fields) {
    set((state) => {
      if (!state.activeProfile) return state
      const draftFields = Object.entries(fields).reduce(
        (draft, [id, value]) => nextDraftWithField(state.activeProfile!, draft, id, value),
        { ...state.draftFields },
      )
      return {
        draftFields,
        hasDirtyFields: Object.keys(dirtyFields(state.activeProfile, draftFields)).length > 0,
      }
    })
  },

  async readBoardToDraft() {
    const profile = get().activeProfile
    if (!profile || get().syncing || get().saving) return
    const link = useBleStore.getState()
    if (link.status !== 'connected' || !canRunFirmwareCommand(link.linkIntegrity)) {
      set({ error: firmwareCommandBlockedMessage(link.linkIntegrity) })
      return
    }
    const capturedFields = { ...profile.fields, ...get().draftFields }
    set({ syncing: true, error: null })
    const snapshot = await useTuneSnapshotStore.getState().read()
    if (!snapshot) {
      set({ syncing: false, error: useTuneSnapshotStore.getState().error ?? 'Board read failed.' })
      return
    }
    const state = get()
    if (
      state.activeProfile?.id === profile.id &&
      snapshot.boardId === profile.boardId &&
      isCompatibleProfile(profile, snapshot.boardId, snapshot.refloatBaseVersion ?? null) &&
      useTuneSnapshotStore.getState().status === 'ready' &&
      useBleStore.getState().status === 'connected'
    ) {
      const boardFields = fieldsFromSnapshot(snapshot)
      const recognized = Object.fromEntries(
        Object.entries(boardFields).filter(([id, value]) => id in profile.fields && value != null),
      )
      const currentFields = { ...profile.fields, ...state.draftFields }
      const replacements = Object.fromEntries(
        Object.entries(recognized).filter(([id]) =>
          sameFieldValue(currentFields[id], capturedFields[id]),
        ),
      )
      const draftFields = dirtyFields(profile, { ...state.draftFields, ...replacements })
      set({ draftFields, hasDirtyFields: Object.keys(draftFields).length > 0 })
      get().setBoardSnapshot(snapshot)
    }
    set({ syncing: false })
  },

  async sendDraftToBoard() {
    const state = get()
    const profile = state.activeProfile
    if (!profile || state.syncing || state.saving) return
    const linkIntegrity = useBleStore.getState().linkIntegrity
    if (useBleStore.getState().status !== 'connected' || !canRunFirmwareCommand(linkIntegrity)) {
      set({ error: firmwareCommandBlockedMessage(linkIntegrity) })
      return
    }
    const captured = { ...profile.fields, ...state.draftFields }
    set({ syncing: true, error: null })
    try {
      const snapshot = await nativeSendTuneDraftToBoard(profile.id, captured)
      if (
        get().activeBoardId === snapshot.boardId &&
        useBleStore.getState().status === 'connected'
      ) {
        useTuneSnapshotStore.getState().setSnapshot(snapshot)
        get().setBoardSnapshot(snapshot)
      }
      set({ syncing: false })
    } catch (error) {
      useTuneSnapshotStore.getState().clear()
      set({ syncing: false, error: errorMessage(error, 'Unable to send tune draft.') })
      throw error
    }
  },

  setDraftField(fieldId, value) {
    set((state) => {
      if (!state.activeProfile) return state
      const savedValue = state.activeProfile.fields[fieldId]
      const draftFields = sameFieldValue(value, savedValue)
        ? omitKey(state.draftFields, fieldId)
        : { ...state.draftFields, [fieldId]: value }
      return {
        draftFields,
        hasDirtyFields: Object.keys(dirtyFields(state.activeProfile, draftFields)).length > 0,
      }
    })
  },

  setBoardSnapshot(snapshot) {
    const boardFields = fieldsFromSnapshot(snapshot)
    const boardEncodingScales = Object.fromEntries(
      snapshot?.groups.flatMap((group) =>
        group.fields.map((field) => [field.id, field.encodingScale ?? null]),
      ) ?? [],
    )
    set((state) => {
      const diff = boardDiff(state.activeProfile, boardFields, boardEncodingScales)
      return {
        boardFields,
        boardEncodingScales,
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
      const draftFields = omitKey(state.draftFields, fieldId)
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
    if (!profile || get().saving) return null
    const dirty = get().getDirtyFields()
    if (Object.keys(dirty).length === 0) return profile
    set({ saving: true, error: null })
    try {
      const saved = await nativeSaveProfile(profile.id, { ...profile.fields, ...dirty })
      set((state) => {
        if (state.activeProfile?.id !== profile.id) return { saving: false }
        const currentFields = { ...state.activeProfile.fields, ...state.draftFields }
        const remainingDraft = dirtyFields(saved, currentFields)
        const diff = boardDiff(saved, state.boardFields, state.boardEncodingScales)
        return {
          profiles: state.profiles.map((item) => (item.id === saved.id ? saved : item)),
          activeProfile: saved,
          draftFields: remainingDraft,
          hasDirtyFields: Object.keys(dirtyFields(saved, remainingDraft)).length > 0,
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
      set({
        syncing: false,
        error: errorMessage(error, 'Unable to sync tune profile to the board.'),
      })
      throw error
    }
  },
})
