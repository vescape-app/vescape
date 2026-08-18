import type { StoreApi } from 'zustand'
import {
  deleteProfile as nativeDeleteProfile,
  getProfileHistory as nativeGetProfileHistory,
  getTuneProfile as nativeGetTuneProfile,
  getTuneProfiles as nativeGetTuneProfiles,
  copyProfileToBoard as nativeCopyProfileToBoard,
  rollbackProfile as nativeRollbackProfile,
} from 'vescape-core'

import { errorMessage } from '@/helpers/error'
import {
  DEFAULT_TUNE_PROFILE_COLOR,
  DEFAULT_TUNE_PROFILE_ICON,
} from '@/modules/tune/lib/profileMetadata'
import {
  boardDiff,
  createNativeProfileWithMetadata,
  isCompatibleProfile,
  renameNativeProfileWithMetadata,
  withDefaultMetadata,
} from '@/modules/tune/store/tuneProfileHelpers'
import {
  INITIAL_TUNE_PROFILE_STATE,
  type TuneProfileActions,
  type TuneProfileState,
  type TuneProfileStore,
} from '@/modules/tune/store/tuneProfileStoreTypes'

/** Ignores results of a load that a newer load has already superseded. */
let profileLoadRequestId = 0

/** Reading, creating, renaming, deleting and copying whole profiles. */
type TuneProfileLibrarySlice = TuneProfileState &
  Pick<
    TuneProfileActions,
    | 'loadProfiles'
    | 'loadProfile'
    | 'setActiveProfile'
    | 'createProfile'
    | 'renameProfile'
    | 'deleteProfile'
    | 'loadHistory'
    | 'rollbackToHistory'
    | 'copyProfileToBoard'
    | 'clear'
  >

type SliceFactory = (
  set: StoreApi<TuneProfileStore>['setState'],
  get: StoreApi<TuneProfileStore>['getState'],
) => TuneProfileLibrarySlice

export const createTuneProfileLibrarySlice: SliceFactory = (set, get) => ({
  ...INITIAL_TUNE_PROFILE_STATE,

  async loadProfiles(boardId, refloatBaseVersion) {
    const requestId = ++profileLoadRequestId
    const state = get()
    const currentActive = state.activeProfile
    const compatibilityChanged =
      state.activeBoardId !== boardId || state.refloatBaseVersion !== refloatBaseVersion
    set({
      loading: true,
      error: null,
      activeBoardId: boardId,
      refloatBaseVersion,
      ...(compatibilityChanged
        ? {
            profiles: [],
            activeProfile: null,
            draftFields: {},
            hasDirtyFields: false,
            boardDiff: [],
            hasBoardDiff: false,
          }
        : {}),
    })
    try {
      const loadedProfiles = (await nativeGetTuneProfiles(boardId, refloatBaseVersion)).map(
        withDefaultMetadata,
      )
      if (
        requestId !== profileLoadRequestId ||
        get().activeBoardId !== boardId ||
        get().refloatBaseVersion !== refloatBaseVersion
      ) {
        return get().profiles
      }
      const profiles = loadedProfiles.filter((profile) =>
        isCompatibleProfile(profile, boardId, refloatBaseVersion),
      )
      const activeProfile =
        currentActive && isCompatibleProfile(currentActive, boardId, refloatBaseVersion)
          ? (profiles.find((profile) => profile.id === currentActive.id) ?? profiles[0] ?? null)
          : (profiles[0] ?? null)
      const diff = boardDiff(activeProfile, get().boardFields)
      set({
        profiles,
        activeProfile,
        draftFields: {},
        hasDirtyFields: false,
        boardDiff: diff,
        hasBoardDiff: diff.length > 0,
        loading: false,
        error: null,
      })
      return profiles
    } catch (error) {
      if (
        requestId !== profileLoadRequestId ||
        get().activeBoardId !== boardId ||
        get().refloatBaseVersion !== refloatBaseVersion
      ) {
        return get().profiles
      }
      set({ loading: false, error: errorMessage(error, 'Unable to load tune profiles.') })
      throw error
    }
  },

  async loadProfile(profileId) {
    set({ loading: true, error: null })
    try {
      const profile = await nativeGetTuneProfile(profileId)
      const current = get()
      const compatible =
        profile == null ||
        current.activeBoardId == null ||
        current.refloatBaseVersion == null ||
        isCompatibleProfile(profile, current.activeBoardId, current.refloatBaseVersion)
      if (!compatible) {
        set({ loading: false, error: null })
        return null
      }
      const normalizedProfile = profile ? withDefaultMetadata(profile) : null
      set((state) => {
        const diff = boardDiff(normalizedProfile, state.boardFields)
        return {
          profiles:
            normalizedProfile == null
              ? state.profiles
              : state.profiles.some((item) => item.id === normalizedProfile.id)
                ? state.profiles.map((item) =>
                    item.id === normalizedProfile.id ? normalizedProfile : item,
                  )
                : [...state.profiles, normalizedProfile],
          activeProfile: normalizedProfile,
          activeBoardId: normalizedProfile?.boardId ?? state.activeBoardId,
          draftFields: {},
          hasDirtyFields: false,
          boardDiff: diff,
          hasBoardDiff: diff.length > 0,
          loading: false,
          error: null,
        }
      })
      return normalizedProfile
    } catch (error) {
      set({ loading: false, error: errorMessage(error, 'Unable to load tune profiles.') })
      throw error
    }
  },

  setActiveProfile(profileId) {
    set((state) => {
      const profile =
        state.profiles.find(
          (p) =>
            p.id === profileId &&
            isCompatibleProfile(p, state.activeBoardId, state.refloatBaseVersion),
        ) ?? null
      if (!profile) return state
      const diff = boardDiff(profile, state.boardFields)
      return {
        activeProfile: profile,
        draftFields: {},
        hasDirtyFields: false,
        boardDiff: diff,
        hasBoardDiff: diff.length > 0,
      }
    })
  },

  async createProfile(name, icon, color, cloneFromProfileId) {
    const state = get()
    if (!state.activeBoardId || !state.refloatBaseVersion) return null
    const sourceFields = cloneFromProfileId
      ? (state.profiles.find(
          (p) =>
            p.id === cloneFromProfileId &&
            isCompatibleProfile(p, state.activeBoardId, state.refloatBaseVersion),
        )?.fields ?? {})
      : state.boardFields
    try {
      const profile = await createNativeProfileWithMetadata(
        state.activeBoardId,
        name,
        icon || DEFAULT_TUNE_PROFILE_ICON,
        color || DEFAULT_TUNE_PROFILE_COLOR,
        sourceFields,
        state.refloatBaseVersion,
      )
      set((prevState) => {
        const diff = boardDiff(profile, prevState.boardFields)
        return {
          profiles: [...prevState.profiles, profile],
          activeProfile: profile,
          draftFields: {},
          hasDirtyFields: false,
          boardDiff: diff,
          hasBoardDiff: diff.length > 0,
        }
      })
      return profile
    } catch (error) {
      set({ error: errorMessage(error, 'Unable to load tune profiles.') })
      return null
    }
  },

  async renameProfile(profileId, name, icon, color) {
    try {
      const updated = await renameNativeProfileWithMetadata(
        profileId,
        name,
        icon || DEFAULT_TUNE_PROFILE_ICON,
        color || DEFAULT_TUNE_PROFILE_COLOR,
      )
      set((state) => ({
        profiles: state.profiles.map((p) => (p.id === updated.id ? updated : p)),
        activeProfile: state.activeProfile?.id === updated.id ? updated : state.activeProfile,
      }))
      return updated
    } catch (error) {
      set({ error: errorMessage(error, 'Unable to load tune profiles.') })
      return null
    }
  },

  async deleteProfile(profileId) {
    try {
      await nativeDeleteProfile(profileId)
      set((state) => {
        const remaining = state.profiles.filter((p) => p.id !== profileId)
        const needSwitch = state.activeProfile?.id === profileId
        const nextActive = needSwitch ? (remaining[0] ?? null) : state.activeProfile
        const diff = boardDiff(nextActive, state.boardFields)
        return {
          profiles: remaining,
          activeProfile: nextActive,
          draftFields: needSwitch ? {} : state.draftFields,
          hasDirtyFields: needSwitch ? false : state.hasDirtyFields,
          boardDiff: diff,
          hasBoardDiff: diff.length > 0,
        }
      })
    } catch (error) {
      set({ error: errorMessage(error, 'Unable to load tune profiles.') })
    }
  },

  async loadHistory(profileId) {
    try {
      return await nativeGetProfileHistory(profileId)
    } catch (error) {
      set({ error: errorMessage(error, 'Unable to load tune profiles.') })
      return []
    }
  },

  async rollbackToHistory(historyEntryId) {
    const profile = get().activeProfile
    if (!profile) return null
    try {
      const restored = await nativeRollbackProfile(profile.id, historyEntryId)
      set((state) => {
        const diff = boardDiff(restored, state.boardFields)
        return {
          profiles: state.profiles.map((p) => (p.id === restored.id ? restored : p)),
          activeProfile: restored,
          draftFields: {},
          hasDirtyFields: false,
          boardDiff: diff,
          hasBoardDiff: diff.length > 0,
        }
      })
      return restored
    } catch (error) {
      set({ error: errorMessage(error, 'Unable to load tune profiles.') })
      return null
    }
  },

  async copyProfileToBoard(profileId, targetBoardId, newName) {
    try {
      return await nativeCopyProfileToBoard(profileId, targetBoardId, newName)
    } catch (error) {
      set({ error: errorMessage(error, 'Unable to load tune profiles.') })
      return null
    }
  },

  clear() {
    profileLoadRequestId += 1
    set({
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
    })
  },
})
