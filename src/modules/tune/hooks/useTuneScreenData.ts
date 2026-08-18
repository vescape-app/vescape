import { useCallback, useEffect, useMemo } from 'react'
import type { RefloatConfigGroup, RefloatConfigSnapshot, TuneProfileFieldValue } from 'vescape-core'

import { useBoardStore } from '@/modules/board/store/boardStore'
import { useBleStore } from '@/modules/board/store/bleStore'
import { useBoardConfigValuesStore } from '@/modules/board/store/boardConfigValuesStore'
import { useTuneProfileStore } from '@/modules/tune/store/tuneProfileStore'
import { useTuneSnapshotStore } from '@/modules/tune/store/tuneSnapshotStore'
import { APP_TUNE_FIELD_BY_ID } from '@/modules/tune/lib/fields'
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
  readBoardSnapshot,
  loadProfiles,
}: {
  boardConnected: boolean
  firmwareCommandsTrusted?: boolean
  selectedBoardId: string | null
  readBoardSnapshot: () => Promise<RefloatConfigSnapshot | null>
  loadProfiles: (boardId: string, snapshot: RefloatConfigSnapshot | null) => Promise<unknown>
}) {
  if (!boardConnected || !firmwareCommandsTrusted) return
  const snapshot = await readBoardSnapshot()
  const boardId = snapshot?.boardId ?? selectedBoardId
  if (boardId && boardId === selectedBoardId) {
    await loadProfiles(boardId, snapshot).catch(() => [])
  }
}

function groupsWithProfileValues(
  groups: RefloatConfigGroup[],
  fields: Record<string, TuneProfileFieldValue> | null,
): RefloatConfigGroup[] {
  return groups.map((group) => ({
    ...group,
    fields: group.fields.map((field) => {
      const appField = APP_TUNE_FIELD_BY_ID.get(field.id)
      const profileValue = fields?.[field.id]
      return {
        ...field,
        label: appField?.label ?? field.label,
        unit: appField?.unit ?? field.unit,
        min: appField?.min ?? field.min,
        max: appField?.max ?? field.max,
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
  const boardSnapshot = useTuneSnapshotStore((s) => s.snapshot)
  const boardSnapshotError = useTuneSnapshotStore((s) => s.error)
  const readBoardSnapshot = useTuneSnapshotStore((s) => s.read)
  const clearBoardSnapshot = useTuneSnapshotStore((s) => s.clear)
  const selectedBoard = useMemo(
    () => allBoards.find((board) => board.id === selectedBoardId) ?? null,
    [allBoards, selectedBoardId],
  )
  const currentBoardSnapshot =
    boardSnapshot?.boardId === selectedBoardId ||
    (boardSnapshot?.boardId == null && selectedBoardId != null)
      ? boardSnapshot
      : null
  const boardConfigValues = useBoardConfigValuesStore((s) => s.values)
  // Cached board values render while the session read is still on the wire; the fresh snapshot
  // replaces them the moment it lands (ADR 0035).
  const prefill = useMemo(
    () => (boardSnapshot ? null : boardConfigPrefill(boardConfigValues, selectedBoardId)),
    [boardConfigValues, boardSnapshot, selectedBoardId],
  )
  const boardValues: TuneBoardValues | null = boardSnapshot ?? prefill
  const tuneCompatibility =
    currentBoardSnapshot?.refloatBaseVersion ?? selectedBoard?.link?.refloatBaseVersion ?? null
  const tuneCompatibilityIssue = useMemo(
    () =>
      boardSnapshotStatus === 'ready'
        ? getTuneCompatibilityIssue(currentBoardSnapshot, tuneCompatibility)
        : null,
    [boardSnapshotStatus, currentBoardSnapshot, tuneCompatibility],
  )
  const boardsLoaded = useBoardStore((s) => s.hasLoaded)
  const loadBoards = useBoardStore((s) => s.load)
  const profiles = useTuneProfileStore((s) => s.profiles)
  const activeProfile = useTuneProfileStore((s) => s.activeProfile)
  const profileBoardId = useTuneProfileStore((s) => s.activeBoardId)
  const draftFields = useTuneProfileStore((s) => s.draftFields)
  const hasDirtyFields = useTuneProfileStore((s) => s.hasDirtyFields)
  const profileLoading = useTuneProfileStore((s) => s.loading)
  const savingProfile = useTuneProfileStore((s) => s.saving)
  const syncingProfile = useTuneProfileStore((s) => s.syncing)
  const profileError = useTuneProfileStore((s) => s.error)
  const boardDiff = useTuneProfileStore((s) => s.boardDiff)
  const hasBoardDiff = useTuneProfileStore((s) => s.hasBoardDiff)
  const loadProfiles = useTuneProfileStore((s) => s.loadProfiles)
  const setBoardSnapshot = useTuneProfileStore((s) => s.setBoardSnapshot)
  const getDirtyFields = useTuneProfileStore((s) => s.getDirtyFields)
  const clearProfiles = useTuneProfileStore((s) => s.clear)
  const loadProfileConfig = useCallback(
    async (boardId: string) => {
      setBoardSnapshot(null)
      await loadProfiles(boardId, tuneCompatibility).catch(() => [])
    },
    [loadProfiles, setBoardSnapshot, tuneCompatibility],
  )

  const retryBoardSnapshot = useCallback(async () => {
    await refreshBoardSnapshotAndProfiles({
      boardConnected,
      firmwareCommandsTrusted,
      selectedBoardId,
      readBoardSnapshot,
      loadProfiles: (boardId, snapshot) =>
        loadProfiles(
          boardId,
          snapshot?.refloatBaseVersion ?? selectedBoard?.link?.refloatBaseVersion ?? null,
        ).catch(() => []),
    })
  }, [
    boardConnected,
    firmwareCommandsTrusted,
    loadProfiles,
    readBoardSnapshot,
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
      setBoardSnapshot(null)
    }
  }, [boardsLoaded, clearProfiles, loadProfileConfig, selectedBoardId, setBoardSnapshot])

  useEffect(() => {
    if (!boardConnected || !firmwareCommandsTrusted) {
      clearBoardSnapshot()
      return
    }
    // The session read is authoritative until the link drops (ADR 0035), so re-entering the screen
    // reuses what it produced instead of putting a second read on the wire.
    if (currentBoardSnapshot) return
    void retryBoardSnapshot()
  }, [
    boardConnected,
    clearBoardSnapshot,
    currentBoardSnapshot,
    firmwareCommandsTrusted,
    retryBoardSnapshot,
  ])

  useEffect(() => {
    setBoardSnapshot(boardValues)
  }, [boardValues, setBoardSnapshot])

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
    return groupsFromFieldValues(profileFields)
  }, [boardValues, profileFields])

  const basicSliders = useMemo(() => basicSlidersFromGroups(displayGroups), [displayGroups])

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const dirtyFields = useMemo(() => getDirtyFields(), [getDirtyFields, draftFields, activeProfile])

  const schemaMismatchFields = useMemo(() => {
    if (!activeProfile || !boardSnapshot) return null
    const boardFieldIds = new Set(boardSnapshot.groups.flatMap((g) => g.fields.map((f) => f.id)))
    const profileFieldIds = Object.keys(activeProfile.fields)
    const profileOnly = profileFieldIds.filter((id) => !boardFieldIds.has(id))
    const boardOnly = [...boardFieldIds].filter(
      (id) => !Object.prototype.hasOwnProperty.call(activeProfile.fields, id),
    )
    if (profileOnly.length === 0 && boardOnly.length === 0) return null
    return { profileOnly, boardOnly }
  }, [activeProfile, boardSnapshot])

  const boardDiffByField = useMemo(
    () => new Map(boardDiff.map((item) => [item.fieldId, item])),
    [boardDiff],
  )

  const boardSnapshotReady = firmwareCommandsTrusted && boardSnapshotStatus === 'ready'
  const syncBarState = useMemo(
    () =>
      getSyncBarState({
        hasProfile: activeProfile != null,
        bleStatus,
        hasDirtyFields,
        hasBoardDiff,
        dirtyCount: Object.keys(dirtyFields).length,
        diffCount: boardDiff.length,
        loadingConfig: firmwareCommandsTrusted && boardSnapshotStatus === 'loading',
        configError:
          firmwareCommandBlockReason ?? (firmwareCommandsTrusted ? boardSnapshotError : null),
        boardSnapshotReady,
        saving: savingProfile,
        syncing: syncingProfile,
      }),
    [
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
      savingProfile,
      syncingProfile,
    ],
  )

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
    boardSnapshot: boardSnapshot as RefloatConfigSnapshot | null,
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
    retryBoardSnapshot,
    schemaMismatchFields,
    selectedBoardId,
    syncBarState,
    tuneCompatibilityIssue,
  }
}
