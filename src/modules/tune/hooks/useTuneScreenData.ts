import { useCallback, useEffect, useMemo } from 'react'
import type { BoardConfigValues, TuneProfileFieldValue } from 'vescape-core'

import { useBoardStore } from '@/modules/board/store/boardStore'
import { useBleStore } from '@/modules/board/store/bleStore'
import { useBoardConfigFields } from '@/modules/board/store/boardConfigValuesStore'
import {
  getFieldLabel,
  type ResolvedBoardConfigField,
  type ResolvedBoardConfigGroup,
} from '@/modules/board/lib/refloatFieldOverlay'
import { useTuneProfileStore } from '@/modules/tune/store/tuneProfileStore'
import { useTuneSnapshotStore } from '@/modules/tune/store/tuneSnapshotStore'
import {
  boardConfigPrefill,
  groupsFromFieldValues,
  type TuneBoardValues,
} from '@/modules/tune/lib/boardConfigPrefill'
import {
  canRunFirmwareCommand,
  firmwareCommandBlockedMessage,
} from '@/modules/board/lib/boardLinkIntegrity'
import { isDisplayableFieldValue } from '@/modules/tune/lib/fieldValues'
import { basicSlidersFromGroups } from '@/modules/tune/lib/sliderDefinitions'
import { getSyncBarState } from '@/modules/tune/lib/syncBarState'
import { getTuneCompatibilityIssue } from '@/modules/tune/lib/tuneCompatibility'

type ProfileState =
  | { phase: 'loading'; error: null }
  | { phase: 'ready'; error: null }
  | { phase: 'empty'; error: null }
  | { phase: 'error'; error: string; retry: 'online' | 'offline' }

export async function refreshBoardSnapshotAndProfiles({
  boardConnected,
  firmwareCommandsTrusted = boardConnected,
  selectedBoardId,
  readBoardConfig,
  loadProfiles,
}: {
  boardConnected: boolean
  firmwareCommandsTrusted?: boolean
  selectedBoardId: string | null
  readBoardConfig: () => Promise<BoardConfigValues | null>
  loadProfiles: (boardId: string, boardConfig: BoardConfigValues | null) => Promise<unknown>
}) {
  if (!boardConnected || !firmwareCommandsTrusted) return
  const boardConfig = await readBoardConfig()
  const boardId = boardConfig?.boardId ?? selectedBoardId
  if (boardId && boardId === selectedBoardId) {
    // intentional-suppression: Tune store error is rendered by the active screen or modal
    await loadProfiles(boardId, boardConfig).catch(() => [])
  }
}

function groupsWithProfileValues(
  groups: ResolvedBoardConfigGroup[],
  fields: Record<string, TuneProfileFieldValue> | null,
): ResolvedBoardConfigGroup[] {
  return groups.map((group) => ({
    ...group,
    fields: group.fields.map((field) => {
      const profileValue = fields?.[field.id]
      return {
        ...field,
        value: isDisplayableFieldValue(profileValue) ? profileValue : field.value,
      }
    }),
  }))
}

export function useTuneScreenData() {
  const bleStatus = useBleStore((s) => s.status)
  const linkIntegrity = useBleStore((s) => s.linkIntegrity)
  const boardConnected = bleStatus === 'connected'
  const firmwareCommandsTrusted = boardConnected && canRunFirmwareCommand(linkIntegrity)
  const firmwareCommandBlockReason =
    boardConnected && !firmwareCommandsTrusted ? firmwareCommandBlockedMessage(linkIntegrity) : null
  const allBoards = useBoardStore((s) => s.boards)
  const selectedBoardId = useBoardStore((s) => s.activeBoardId)
  const boardSnapshotStatus = useTuneSnapshotStore((s) => s.status)
  const refreshedBoardConfig = useTuneSnapshotStore((s) => s.boardConfig)
  const boardSnapshotError = useTuneSnapshotStore((s) => s.error)
  const readBoardConfig = useTuneSnapshotStore((s) => s.read)
  const clearBoardConfig = useTuneSnapshotStore((s) => s.clear)
  const selectedBoard = useMemo(
    () => allBoards.find((board) => board.id === selectedBoardId) ?? null,
    [allBoards, selectedBoardId],
  )
  const currentRefreshedConfig =
    refreshedBoardConfig?.boardId === selectedBoardId ||
    (refreshedBoardConfig?.boardId == null && selectedBoardId != null)
      ? refreshedBoardConfig
      : null
  const storedBoardConfig = useBoardConfigFields(selectedBoardId ?? undefined)
  const activeBoardConfig = currentRefreshedConfig ?? storedBoardConfig
  const prefill = useMemo(
    () => (currentRefreshedConfig ? null : boardConfigPrefill(storedBoardConfig, selectedBoardId)),
    [currentRefreshedConfig, selectedBoardId, storedBoardConfig],
  )
  const boardValues: TuneBoardValues | null = useMemo(
    () =>
      currentRefreshedConfig
        ? boardConfigPrefill(currentRefreshedConfig, selectedBoardId)
        : prefill,
    [currentRefreshedConfig, prefill, selectedBoardId],
  )
  const tuneCompatibility =
    activeBoardConfig?.refloatBaseVersion ?? selectedBoard?.link?.refloatBaseVersion ?? null
  const tuneCompatibilityIssue = useMemo(
    () =>
      boardSnapshotStatus === 'ready'
        ? getTuneCompatibilityIssue(
            currentRefreshedConfig,
            tuneCompatibility,
            selectedBoard?.link?.refloatVersion ?? null,
          )
        : null,
    [
      boardSnapshotStatus,
      currentRefreshedConfig,
      selectedBoard?.link?.refloatVersion,
      tuneCompatibility,
    ],
  )
  const boardsLoaded = useBoardStore((s) => s.hasLoaded)
  const loadBoards = useBoardStore((s) => s.load)
  const profiles = useTuneProfileStore((s) => s.profiles)
  const activeProfile = useTuneProfileStore((s) => s.activeProfile)
  const profileBoardId = useTuneProfileStore((s) => s.activeBoardId)
  const draftFields = useTuneProfileStore((s) => s.draftFields)
  const hasDirtyFields = useTuneProfileStore((s) => s.hasDirtyFields)
  const pendingBoardChangeset = useTuneProfileStore((s) => s.pendingBoardChangeset)
  const profileLoading = useTuneProfileStore((s) => s.loading)
  const savingProfile = useTuneProfileStore((s) => s.saving)
  const syncingProfile = useTuneProfileStore((s) => s.syncing)
  const profileError = useTuneProfileStore((s) => s.error)
  const boardDiff = useTuneProfileStore((s) => s.boardDiff)
  const hasBoardDiff = useTuneProfileStore((s) => s.hasBoardDiff)
  const loadProfiles = useTuneProfileStore((s) => s.loadProfiles)
  const setBoardConfig = useTuneProfileStore((s) => s.setBoardConfig)
  const getDirtyFields = useTuneProfileStore((s) => s.getDirtyFields)
  const clearProfiles = useTuneProfileStore((s) => s.clear)
  const loadProfileConfig = useCallback(
    async (boardId: string) => {
      setBoardConfig(null)
      // intentional-suppression: Tune store error is rendered by the active screen or modal
      await loadProfiles(boardId, tuneCompatibility).catch(() => [])
    },
    [loadProfiles, setBoardConfig, tuneCompatibility],
  )

  const retryBoardSnapshot = useCallback(async () => {
    await refreshBoardSnapshotAndProfiles({
      boardConnected,
      firmwareCommandsTrusted,
      selectedBoardId,
      readBoardConfig,
      loadProfiles: (boardId, boardConfig) =>
        // intentional-suppression: Tune store error is rendered by the active screen or modal
        loadProfiles(
          boardId,
          boardConfig?.refloatBaseVersion ?? selectedBoard?.link?.refloatBaseVersion ?? null,
        ).catch(() => []),
    })
  }, [
    boardConnected,
    firmwareCommandsTrusted,
    loadProfiles,
    readBoardConfig,
    selectedBoard?.link?.refloatBaseVersion,
    selectedBoardId,
  ])

  useEffect(() => {
    if (!boardsLoaded) {
      void loadBoards()
    }
  }, [boardsLoaded, loadBoards])

  useEffect(() => {
    if (selectedBoardId) {
      void loadProfileConfig(selectedBoardId)
    } else if (boardsLoaded) {
      clearProfiles()
      setBoardConfig(null)
    }
  }, [boardsLoaded, clearProfiles, loadProfileConfig, selectedBoardId, setBoardConfig])

  useEffect(() => {
    if (!boardConnected || !firmwareCommandsTrusted) {
      clearBoardConfig()
      return
    }
    if (currentRefreshedConfig) return
    void retryBoardSnapshot()
  }, [
    boardConnected,
    clearBoardConfig,
    currentRefreshedConfig,
    firmwareCommandsTrusted,
    retryBoardSnapshot,
  ])

  useEffect(() => {
    setBoardConfig(currentRefreshedConfig)
  }, [currentRefreshedConfig, setBoardConfig])

  const profileFields = useMemo(
    () => (activeProfile ? { ...activeProfile.fields, ...draftFields } : null),
    [activeProfile, draftFields],
  )

  const profileState = useMemo<ProfileState>(() => {
    if (!selectedBoardId) return { phase: 'loading', error: null }
    if (boardConnected && boardSnapshotStatus === 'loading' && !activeProfile && !prefill) {
      return { phase: 'loading', error: null }
    }
    if (profileLoading && !activeProfile) return { phase: 'loading', error: null }
    if (boardConnected && boardSnapshotError && !activeProfile) {
      return { phase: 'error', error: boardSnapshotError, retry: 'online' }
    }
    if (boardConnected && tuneCompatibilityIssue && !activeProfile) {
      return { phase: 'error', error: tuneCompatibilityIssue.message, retry: 'online' }
    }
    if (profileError && !activeProfile) {
      return { phase: 'error', error: profileError, retry: 'offline' }
    }
    if (profileBoardId === selectedBoardId && profiles.length === 0) {
      return { phase: 'empty', error: null }
    }
    if (activeProfile) return { phase: 'ready', error: null }
    return { phase: 'loading', error: null }
  }, [
    activeProfile,
    boardConnected,
    boardSnapshotError,
    boardSnapshotStatus,
    profileBoardId,
    profileError,
    profileLoading,
    prefill,
    profiles.length,
    selectedBoardId,
    tuneCompatibilityIssue,
  ])

  const displayGroups = useMemo(() => {
    if (boardValues) {
      return groupsWithProfileValues(boardValues.groups, profileFields)
    }
    return groupsFromFieldValues(profileFields, activeBoardConfig?.schema)
  }, [activeBoardConfig?.schema, boardValues, profileFields])

  const resolvedFieldsById = useMemo(() => {
    const map = new Map<string, ResolvedBoardConfigField>()
    for (const group of displayGroups) {
      for (const field of group.fields) {
        map.set(field.id, field)
      }
    }
    return map
  }, [displayGroups])

  const basicSliders = useMemo(() => basicSlidersFromGroups(displayGroups), [displayGroups])

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const dirtyFields = useMemo(() => getDirtyFields(), [getDirtyFields, draftFields, activeProfile])

  const schemaMismatchFields = useMemo(() => {
    if (!activeProfile || !currentRefreshedConfig || !boardValues) return null
    const boardFieldIds = new Set(boardValues.groups.flatMap((g) => g.fields.map((f) => f.id)))
    const profileFieldIds = Object.keys(activeProfile.fields)
    const profileOnly = profileFieldIds.filter((id) => !boardFieldIds.has(id))
    const boardOnly = [...boardFieldIds].filter(
      (id) => !Object.prototype.hasOwnProperty.call(activeProfile.fields, id),
    )
    if (profileOnly.length === 0 && boardOnly.length === 0) return null
    return { profileOnly, boardOnly }
  }, [activeProfile, boardValues, currentRefreshedConfig])

  const boardDiffByField = useMemo(
    () => new Map(boardDiff.map((item) => [item.fieldId, item])),
    [boardDiff],
  )

  const boardSnapshotReady = firmwareCommandsTrusted && boardSnapshotStatus === 'ready'
  const syncBarState = useMemo(() => {
    const driftingDiffs = boardDiff.filter(({ fieldId }) => !(fieldId in dirtyFields))
    const pendingSyncCount =
      pendingBoardChangeset && pendingBoardChangeset.profileId === activeProfile?.id
        ? Object.keys(pendingBoardChangeset.changes).length
        : 0
    const schemaById = new Map(
      (activeBoardConfig?.schema?.fields ?? []).map((field) => [field.id, field]),
    )
    return getSyncBarState({
      hasProfile: activeProfile != null,
      bleStatus,
      hasDirtyFields,
      hasBoardDiff,
      dirtyCount: Object.keys(dirtyFields).length,
      diffCount: driftingDiffs.length,
      diffLabels: driftingDiffs.map(({ fieldId }) =>
        getFieldLabel(fieldId, schemaById.get(fieldId)),
      ),
      pendingSyncCount,
      loadingConfig: firmwareCommandsTrusted && boardSnapshotStatus === 'loading',
      configError:
        firmwareCommandBlockReason ?? (firmwareCommandsTrusted ? boardSnapshotError : null),
      boardSnapshotReady,
      saving: savingProfile,
      syncing: syncingProfile,
    })
  }, [
    activeBoardConfig?.schema?.fields,
    activeProfile,
    bleStatus,
    firmwareCommandsTrusted,
    firmwareCommandBlockReason,
    boardSnapshotError,
    boardSnapshotReady,
    boardSnapshotStatus,
    hasDirtyFields,
    hasBoardDiff,
    dirtyFields,
    boardDiff,
    pendingBoardChangeset,
    savingProfile,
    syncingProfile,
  ])

  return {
    activeProfile,
    allBoards,
    basicSliders,
    bleStatus,
    boardConnected,
    firmwareCommandBlockReason,
    firmwareCommandsTrusted,
    boardDiff,
    boardDiffByField,
    boardConfig: currentRefreshedConfig,
    boardSnapshotError,
    boardSnapshotStatus,
    boardsLoaded,
    dirtyFields,
    displayGroups,
    draftFields,
    loadOffline: loadProfileConfig,
    loadOnline: retryBoardSnapshot,
    profileError,
    profileFields,
    profiles,
    profileState,
    resolvedFieldsById,
    retryBoardSnapshot,
    schemaMismatchFields,
    selectedBoard,
    selectedBoardId,
    syncBarState,
    tuneCompatibilityIssue,
  }
}
