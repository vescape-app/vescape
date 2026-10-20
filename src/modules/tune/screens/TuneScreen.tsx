import { createOfflineTune } from '../lib/offlineTune'
import { useResolvedNeutralColors } from '@/hooks/useTheme'
import { useIsFocused, useNavigation, useRouter } from 'expo-router'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { StyleSheet } from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'

import { Text } from '@/components/base/Text'
import { TuneGroupGrid } from '@/modules/tune/components/TuneGroupGrid'
import { TunePreviewSection } from '@/modules/tune/components/TunePreviewSection'
import { TuneEditorFooter } from '@/modules/tune/components/TuneEditorFooter'
import { RingsEditor } from '@/modules/tune/components/RingsEditor'
import { BoardPickerModal } from '@/modules/tune/components/BoardPickerModal'
import { useBoardStore } from '@/modules/board/store/boardStore'
import { ConfirmModal } from '@/components/modals/ConfirmModal'
import { draftBoardState, tuneBoardActions } from '@/modules/tune/lib/draftBoardState'
import { useTuneModals } from '@/modules/tune/hooks/useTuneModals'
import { useTuneScreenData } from '@/modules/tune/hooks/useTuneScreenData'
import { reportTuneCompatibilityIssue } from '@/modules/tune/lib/tuneCompatibilityReporting'
import { BasicSliderItemCell, TuneFieldCell } from '@/modules/tune/screens/TuneFieldCells'
import { TuneModalHost } from '@/modules/tune/screens/TuneModalHost'
import { TuneScreenHeader } from '@/modules/tune/screens/TuneScreenHeader'
import { TuneEditorNotices } from '@/modules/tune/components/TuneEditorNotices'
import { TuneScreenStates } from '@/modules/tune/screens/TuneScreenStates'
import { useTuneProfileStore } from '@/modules/tune/store/tuneProfileStore'
import { routes } from '@/navigation/routes'

/** Edits the active Tune Profile: Rings, Floaty, Advanced, and shared draft actions. */
export function TuneScreen({
  mode,
  onModeChange,
  settingError,
}: {
  mode: 'rings' | 'floaty' | 'advanced'
  onModeChange: (mode: 'rings' | 'floaty' | 'advanced') => void
  settingError: string | null
}) {
  const neutral = useResolvedNeutralColors()
  const navigation = useNavigation()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const isFocused = useIsFocused()
  const {
    activeProfile,
    allBoards,
    basicSliders,
    boardConnected,
    boardDiffByField,
    boardSnapshot,
    boardSnapshotStatus,
    boardSnapshotError,
    boardsLoaded,
    dirtyFields,
    displayGroups,
    draftFields,
    firmwareCommandsTrusted,
    firmwareCommandBlockReason,
    loadOffline,
    loadOnline,
    profileError,
    profileFields,
    profileState,
    profiles,
    schemaMismatchFields,
    selectedBoardId,
    tuneCompatibilityIssue,
  } = useTuneScreenData()
  const [boardPickerVisible, setBoardPickerVisible] = useState(false)
  const setActiveBoard = useBoardStore((state) => state.setActiveBoard)
  const encodingScales = Object.fromEntries(
    boardSnapshot?.groups.flatMap((group) =>
      group.fields.map((field) => [field.id, field.encodingScale]),
    ) ?? [],
  )

  const reportedCompatibilityIssue = useRef<string | null>(null)
  const [confirmAction, setConfirmAction] = useState<(() => void) | null>(null)
  const noticesError =
    profileError ??
    boardSnapshotError ??
    tuneCompatibilityIssue?.message ??
    firmwareCommandBlockReason
  const dirtyCount = Object.keys(dirtyFields).length
  const syncing = useTuneProfileStore((state) => state.syncing)
  const saving = useTuneProfileStore((state) => state.saving)
  const boardActions = tuneBoardActions({
    connected: boardConnected,
    trusted: firmwareCommandsTrusted,
    snapshotReady: boardSnapshotStatus === 'ready',
    schemaMismatch: schemaMismatchFields != null,
    compatibilityIssue: tuneCompatibilityIssue != null,
    busy: syncing,
    error: profileError != null,
  })
  const readBoardToDraft = useTuneProfileStore((state) => state.readBoardToDraft)
  const sendDraftToBoard = useTuneProfileStore((state) => state.sendDraftToBoard)
  const boardFields = useTuneProfileStore((state) => state.boardFields)
  const setActiveProfile = useTuneProfileStore((s) => s.setActiveProfile)
  const guardedAction = useCallback(
    (action: () => void) => {
      if (dirtyCount > 0) setConfirmAction(() => action)
      else action()
    },
    [dirtyCount],
  )
  const readDraft = useCallback(
    () =>
      guardedAction(() => {
        if (useTuneProfileStore.getState().activeProfile?.id === activeProfile?.id)
          void readBoardToDraft()
      }),
    [activeProfile?.id, guardedAction, readBoardToDraft],
  )
  const selectProfile = useCallback(
    (id: string) => {
      if (id !== activeProfile?.id) guardedAction(() => setActiveProfile(id))
    },
    [activeProfile?.id, guardedAction, setActiveProfile],
  )
  const setDraftFields = useTuneProfileStore((state) => state.setDraftFields)
  const revertField = useTuneProfileStore((s) => s.revertField)
  const acceptBoardField = useTuneProfileStore((s) => s.acceptBoardField)
  const discardAllEdits = useTuneProfileStore((s) => s.discardAllEdits)
  const saveActiveProfile = useTuneProfileStore((s) => s.saveActiveProfile)

  const modals = useTuneModals(activeProfile, basicSliders, draftFields, allBoards, selectedBoardId)

  useEffect(() => {
    if (!tuneCompatibilityIssue || !boardSnapshot) return
    const reportKey = [selectedBoardId, boardSnapshot.refloatVersion, boardSnapshot.fwVersion].join(
      ':',
    )
    if (reportedCompatibilityIssue.current === reportKey) return
    reportedCompatibilityIssue.current = reportKey
    reportTuneCompatibilityIssue(tuneCompatibilityIssue, boardSnapshot)
  }, [boardSnapshot, selectedBoardId, tuneCompatibilityIssue])

  const openHistory = useCallback(() => {
    router.push(routes.tuneHistory)
  }, [router])

  useLayoutEffect(() => {
    navigation.setOptions({
      header: () => (
        <TuneScreenHeader
          paddingTop={Math.max(insets.top, 8)}
          mode={mode}
          onModeChange={onModeChange}
          profiles={profiles}
          activeProfile={activeProfile}
          boardConnected={boardConnected}
          boardSnapshotStatus={boardSnapshotStatus}
          firmwareCommandsTrusted={firmwareCommandsTrusted}
          modals={modals}
          onSelectProfile={selectProfile}
          onOpenHistory={openHistory}
          onReadBoard={readDraft}
          onOpenBoards={() => setBoardPickerVisible(true)}
        />
      ),
    })
  }, [
    mode,
    onModeChange,
    activeProfile,
    boardConnected,
    boardSnapshotStatus,
    firmwareCommandsTrusted,
    insets.top,
    openHistory,
    loadOnline,
    navigation,
    profiles,
    modals,
    setActiveProfile,
    selectProfile,
    readDraft,
  ])

  const handleSave = () => {
    // intentional-suppression: Tune store error is rendered by the active screen or modal
    void saveActiveProfile().catch(() => undefined) // Store error renders in the banner below.
  }

  const handleSend = () => {
    // intentional-suppression: Tune store error is rendered by the active screen
    void sendDraftToBoard().catch(() => undefined)
  }

  const hasTuneView = activeProfile != null

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: neutral.bg }]} edges={['bottom']}>
      <TuneScreenStates
        hasTuneView={hasTuneView}
        boardsLoaded={boardsLoaded}
        selectedBoardId={selectedBoardId}
        profileState={profileState}
        boardSnapshot={boardSnapshot}
        firmwareCommandsTrusted={firmwareCommandsTrusted}
        firmwareCommandBlockReason={firmwareCommandBlockReason}
        loadOnline={loadOnline}
        loadOffline={loadOffline}
        onCreateOffline={async (version) => {
          if (!selectedBoardId) return
          await createOfflineTune(selectedBoardId, version)
          if (useBoardStore.getState().activeBoardId !== selectedBoardId) return
          await loadOffline(selectedBoardId, version)
        }}
        onCreateFirstProfile={() => {
          // intentional-suppression: Tune store error is rendered by the active screen or modal
          void modals.storeCreateProfile('Main', '', '').catch(() => undefined) // Tune error state replaces the empty screen.
        }}
      />

      {settingError ? <Text>{settingError}</Text> : null}
      {mode === 'rings' ? (
        <TuneEditorNotices
          error={noticesError}
          schemaMismatchFields={schemaMismatchFields}
          showBadgeInfo={modals.showBadgeInfo}
        />
      ) : null}
      {mode === 'rings' && activeProfile && profileFields ? (
        <RingsEditor
          key={activeProfile.id}
          active={isFocused}
          fields={profileFields}
          savedFields={activeProfile.fields}
          disabled={syncing}
          encodingScales={encodingScales}
          onPatch={setDraftFields}
        />
      ) : null}
      <TunePreviewSection
        fields={profileFields ?? {}}
        active={isFocused}
        visible={hasTuneView && mode !== 'rings'}
        railId={allBoards.find((board) => board.id === selectedBoardId)?.personalization?.railId}
        railColorId={
          allBoards.find((board) => board.id === selectedBoardId)?.personalization?.railColorId
        }
      >
        <TuneEditorNotices
          error={noticesError}
          schemaMismatchFields={schemaMismatchFields}
          showBadgeInfo={modals.showBadgeInfo}
        />

        {mode === 'floaty' ? (
          <TuneGroupGrid title="Basic">
            {basicSliders.map((item) => (
              <BasicSliderItemCell
                key={item.id}
                item={item}
                editable={activeProfile != null}
                fullWidth={item.id === 'aggressiveness' || item.id === 'atrIntensity'}
                onPress={modals.openBasicSliderEditor}
                onResetFormula={() => modals.handleBasicSliderReset(item.id)}
              />
            ))}
          </TuneGroupGrid>
        ) : null}

        {mode === 'advanced'
          ? displayGroups.map((group) => (
              <TuneGroupGrid
                key={group.id}
                title={group.title}
                subtitle={
                  activeProfile
                    ? `${group.fields.length} profile values${
                        group.fields.some((field) => boardDiffByField.has(field.id))
                          ? ` - ${
                              group.fields.filter((field) => boardDiffByField.has(field.id)).length
                            } changed`
                          : ''
                      }`
                    : `${group.fields.length} read-only values`
                }
              >
                {group.fields.map((field) => (
                  <TuneFieldCell
                    key={field.id}
                    field={field}
                    savedValue={activeProfile?.fields[field.id]}
                    boardValue={boardDiffByField.get(field.id)?.boardValue}
                    profileValue={boardDiffByField.get(field.id)?.profileValue}
                    dirty={Object.prototype.hasOwnProperty.call(dirtyFields, field.id)}
                    boardChanged={boardDiffByField.has(field.id)}
                    onPress={modals.openFieldEditor}
                    onRevert={() => revertField(field.id)}
                    onAcceptBoard={() => acceptBoardField(field.id)}
                  />
                ))}
              </TuneGroupGrid>
            ))
          : null}
      </TunePreviewSection>

      {hasTuneView ? (
        <TuneEditorFooter
          selector={{ profiles, activeProfile, modals, onSelectProfile: selectProfile }}
          dirtyCount={dirtyCount}
          saving={saving}
          busy={syncing}
          reading={boardSnapshotStatus === 'loading'}
          boardConnected={boardConnected}
          canRead={boardActions.canRead}
          canSend={boardActions.canSend}
          boardState={draftBoardState(
            profileFields ?? {},
            boardFields,
            boardActions.confirmed,
            encodingScales,
          )}
          onSave={handleSave}
          onDiscard={discardAllEdits}
          onRead={readDraft}
          onSend={handleSend}
        />
      ) : null}
      <ConfirmModal
        visible={confirmAction != null}
        title="Replace unsaved edits?"
        message="This replaces your current draft. The saved profile and board remain unchanged."
        confirmLabel="Continue"
        onCancel={() => setConfirmAction(null)}
        onConfirm={() => {
          confirmAction?.()
          setConfirmAction(null)
        }}
      />
      <BoardPickerModal
        title="Select tune board"
        visible={boardPickerVisible}
        boards={allBoards}
        onDismiss={() => setBoardPickerVisible(false)}
        onSelect={(board) => {
          setBoardPickerVisible(false)
          if (board.id !== selectedBoardId) guardedAction(() => setActiveBoard(board.id))
        }}
      />
      <TuneModalHost modals={modals} />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
})
