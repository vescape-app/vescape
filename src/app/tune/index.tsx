import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native'
import { Text } from '@/components/base/Text'
import { useIsFocused, useNavigation, useRouter } from 'expo-router'
import {
  ArrowsClockwiseIcon,
  BluetoothSlashIcon,
  ClockCounterClockwiseIcon,
  CopyIcon,
  FadersIcon,
  PencilSimpleIcon,
  TrashIcon,
  WarningCircleIcon,
} from 'phosphor-react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { type RefloatConfigField, type TuneProfileFieldValue } from 'vescape-core'

import { Button } from '@/components/base/Button'
import { IconButton } from '@/components/base/IconButton'
import { ConfirmModal } from '@/components/modals/ConfirmModal'
import { InfoModal } from '@/components/modals/InfoModal'
import { Placeholder } from '@/components/base/Placeholder'
import { BasicSliderCell } from '@/modules/tune/components/BasicSliderCell'
import { FieldEditorPopover } from '@/modules/tune/components/FieldEditorPopover'
import {
  PillSelectorItem,
  PillSelectorAdd,
  PillSelectorMenuItem,
  PillSelector,
} from '@/components/controls/PillSelector'
import { TuneConfigCell } from '@/modules/tune/components/TuneConfigCell'
import {
  TuneProfileMetadataModal,
  tuneProfileColorTheme,
  tuneProfileIconComponent,
} from '@/modules/tune/components/TuneProfileMetadataModal'
import { basicSliderColor, basicSliderIcon } from '@/modules/tune/components/basicSliderIcons'
import { TuneGroupGrid } from '@/modules/tune/components/TuneGroupGrid'
import { TuneSyncBar } from '@/modules/tune/components/TuneSyncBar'
import { TunePreviewSection } from '@/modules/tune/components/TunePreviewSection'
import { routes } from '@/navigation/routes'
import { TextPromptModal } from '@/components/modals/TextPromptModal'
import { BoardPickerModal } from '@/modules/tune/components/BoardPickerModal'
import { useTuneProfileStore } from '@/modules/tune/store/tuneProfileStore'
import type { BasicSliderItem } from '@/modules/tune/lib/sliderDefinitions'
import { useTuneScreenData } from '@/modules/tune/hooks/useTuneScreenData'
import { theme } from '@/constants/theme'
import { useTuneModals } from '@/modules/tune/hooks/useTuneModals'
import type { TuneProfileColorId, TuneProfileIconId } from '@/modules/tune/lib/profileMetadata'
import { reportTuneCompatibilityIssue } from '@/modules/tune/lib/tuneCompatibilityReporting'

// TODO: Split screen orchestration to reduce cyclomatic complexity below 30.
// eslint-disable-next-line complexity
export default function TuneScreen() {
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
    retryBoardSnapshot,
    schemaMismatchFields,
    selectedBoardId,
    syncBarState,
    tuneCompatibilityIssue,
  } = useTuneScreenData()
  const reportedCompatibilityIssue = useRef<string | null>(null)
  const setActiveProfile = useTuneProfileStore((s) => s.setActiveProfile)
  const revertField = useTuneProfileStore((s) => s.revertField)
  const acceptBoardField = useTuneProfileStore((s) => s.acceptBoardField)
  const acceptAllBoardValues = useTuneProfileStore((s) => s.acceptAllBoardValues)
  const discardAllEdits = useTuneProfileStore((s) => s.discardAllEdits)
  const saveActiveProfile = useTuneProfileStore((s) => s.saveActiveProfile)
  const syncToBoard = useTuneProfileStore((s) => s.syncToBoard)

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
      headerTitle: () =>
        profiles.length > 0 ? (
          <PillSelector
            activeId={activeProfile?.id ?? ''}
            contained
            style={styles.headerPills}
            contentContainerStyle={styles.headerPillsContent}
          >
            {profiles.map((profile) => (
              <PillSelectorItem
                key={profile.id}
                id={profile.id}
                label={profile.name}
                icon={tuneProfileIconComponent(profile.icon)}
                activeLabelOnly
                color={tuneProfileColorTheme(profile.color)}
                onPress={() => setActiveProfile(profile.id)}
              >
                <PillSelectorMenuItem
                  icon={PencilSimpleIcon}
                  label="Edit"
                  onPress={() => modals.setMetadataModalProfile(profile)}
                />
                {modals.otherBoards.length > 0 ? (
                  <PillSelectorMenuItem
                    icon={CopyIcon}
                    label="Copy to board"
                    onPress={() => modals.setCopySourceProfile(profile)}
                  />
                ) : null}
                {profiles.length > 1 ? (
                  <PillSelectorMenuItem
                    icon={TrashIcon}
                    label="Delete"
                    onPress={() => modals.setDeleteConfirmProfile(profile)}
                    danger
                    separator
                  />
                ) : null}
              </PillSelectorItem>
            ))}
            <PillSelectorAdd onPress={() => modals.handleCreateProfile(activeProfile?.id)} />
          </PillSelector>
        ) : (
          <Text style={styles.headerTitle}>Tune</Text>
        ),
      headerRight: () => (
        <View style={styles.headerActions}>
          {activeProfile ? (
            <IconButton icon={ClockCounterClockwiseIcon} onPress={() => void openHistory()} />
          ) : null}
          {boardConnected ? (
            <IconButton
              icon={ArrowsClockwiseIcon}
              onPress={() => void loadOnline()}
              loading={boardSnapshotStatus === 'loading'}
              disabled={!firmwareCommandsTrusted}
            />
          ) : null}
        </View>
      ),
    })
  }, [
    activeProfile,
    boardConnected,
    boardSnapshotStatus,
    firmwareCommandsTrusted,
    openHistory,
    loadOnline,
    navigation,
    profiles,
    modals,
    setActiveProfile,
  ])

  const handleSave = () => {
    void saveActiveProfile().catch(() => undefined)
  }

  const handleSaveAndSync = () => {
    if (!firmwareCommandsTrusted) return
    void (async () => {
      await saveActiveProfile()
      await syncToBoard()
    })().catch(() => undefined)
  }

  const handleSync = () => {
    if (!firmwareCommandsTrusted) return
    void syncToBoard().catch(() => undefined)
  }

  const hasTuneView = activeProfile != null

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      {!selectedBoardId && boardsLoaded && !hasTuneView ? (
        <Placeholder
          icon={BluetoothSlashIcon}
          title="No board selected"
          description="Select a board to edit its saved Tune Profile"
        />
      ) : null}

      {profileState.phase === 'loading' && !hasTuneView && selectedBoardId ? (
        <View style={styles.mainState}>
          <ActivityIndicator color={theme.palette.sky.color} />
          <Text style={styles.stateText}>Loading saved tune profile...</Text>
        </View>
      ) : null}

      {profileState.phase === 'empty' ? (
        <View style={styles.mainState}>
          <Placeholder
            icon={FadersIcon}
            title="Create tune based on board config"
            description={
              firmwareCommandBlockReason ??
              'Connect to your board to read its current configuration and create your first Tune Profile'
            }
            action={
              boardSnapshot?.refloatBaseVersion && firmwareCommandsTrusted ? (
                <Button
                  label="Create first profile"
                  icon={FadersIcon}
                  variant="tune"
                  size="lg"
                  style={styles.firstProfileAction}
                  onPress={() => void modals.storeCreateProfile('Main', '', '')}
                />
              ) : null
            }
          />
        </View>
      ) : null}

      {profileState.phase === 'error' && !hasTuneView ? (
        <View style={styles.mainState}>
          <WarningCircleIcon size={28} color={theme.status.error.text} />
          <Text selectable style={styles.errorText}>
            {profileState.error}
          </Text>
          <Button
            label="Retry"
            icon={ArrowsClockwiseIcon}
            onPress={() => {
              if (profileState.retry === 'online') {
                void loadOnline()
              } else if (selectedBoardId) {
                void loadOffline(selectedBoardId)
              }
            }}
          />
        </View>
      ) : null}

      <TunePreviewSection fields={profileFields ?? {}} active={isFocused} visible={hasTuneView}>
        {profileError ? (
          <View style={styles.errorBanner}>
            <WarningCircleIcon size={16} color={theme.status.error.color} />
            <Text style={styles.errorBannerText}>{profileError}</Text>
          </View>
        ) : null}

        {schemaMismatchFields ? (
          <Pressable
            style={styles.schemaMismatchBar}
            onPress={() =>
              modals.showBadgeInfo(
                'Schema Mismatch',
                `Profile and board have different field sets.${
                  schemaMismatchFields.profileOnly.length > 0
                    ? `\n\nIn profile but not board: ${schemaMismatchFields.profileOnly.join(', ')}`
                    : ''
                }${
                  schemaMismatchFields.boardOnly.length > 0
                    ? `\n\nIn board but not profile: ${schemaMismatchFields.boardOnly.join(', ')}`
                    : ''
                }`,
              )
            }
          >
            <WarningCircleIcon size={16} color={theme.palette.yellow.color} weight="fill" />
            <View style={styles.schemaMismatchTextWrap}>
              <Text style={styles.schemaMismatchTitle}>Schema mismatch</Text>
              <Text style={styles.schemaMismatchText}>
                {schemaMismatchFields.profileOnly.length > 0
                  ? `${schemaMismatchFields.profileOnly.length} field${schemaMismatchFields.profileOnly.length === 1 ? '' : 's'} in profile not on board`
                  : ''}
                {schemaMismatchFields.profileOnly.length > 0 &&
                schemaMismatchFields.boardOnly.length > 0
                  ? ' · '
                  : ''}
                {schemaMismatchFields.boardOnly.length > 0
                  ? `${schemaMismatchFields.boardOnly.length} new field${schemaMismatchFields.boardOnly.length === 1 ? '' : 's'} on board`
                  : ''}
              </Text>
            </View>
          </Pressable>
        ) : null}

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

        {displayGroups.map((group) => (
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
        ))}
      </TunePreviewSection>

      {hasTuneView && !modals.editor ? (
        <TuneSyncBar
          state={syncBarState}
          onSave={handleSave}
          onSaveAndSync={handleSaveAndSync}
          onSync={handleSync}
          onUpdateTune={acceptAllBoardValues}
          onDiscard={discardAllEdits}
          onRetryConfig={() => void retryBoardSnapshot()}
          bottomOffset={Math.max(insets.bottom, 24) + 16}
        />
      ) : null}

      <InfoModal
        visible={modals.infoModal != null}
        title={modals.infoModal?.title ?? ''}
        message={modals.infoModal?.message ?? ''}
        onDismiss={() => modals.setInfoModal(null)}
      />

      <FieldEditorPopover
        target={modals.editor}
        onCancel={modals.closeEditor}
        onApply={modals.handleEditorApply}
      />

      <TuneProfileMetadataModal
        visible={modals.createModalOpen}
        title="New Profile"
        confirmLabel="Create"
        initialValue={{
          name: '',
          icon: modals.defaultTuneIcon as TuneProfileIconId,
          color: modals.defaultTuneColor as TuneProfileColorId,
        }}
        onConfirm={({ name, icon, color }) => {
          void modals.storeCreateProfile(name, icon, color, modals.createCloneFromId)
          modals.setCreateModalOpen(false)
        }}
        onDismiss={() => modals.setCreateModalOpen(false)}
      />

      <TuneProfileMetadataModal
        visible={modals.metadataModalProfile != null}
        title="Edit Profile"
        confirmLabel="Save"
        initialValue={{
          name: modals.metadataModalProfile?.name ?? '',
          icon: modals.metadataModalProfile?.icon as TuneProfileIconId | undefined,
          color: modals.metadataModalProfile?.color as TuneProfileColorId | undefined,
        }}
        onConfirm={({ name, icon, color }) => {
          if (modals.metadataModalProfile)
            void modals.storeRenameProfile(modals.metadataModalProfile.id, name, icon, color)
          modals.setMetadataModalProfile(null)
        }}
        onDismiss={() => modals.setMetadataModalProfile(null)}
      />

      <BoardPickerModal
        visible={modals.copySourceProfile != null && modals.copyTargetBoard == null}
        boards={modals.otherBoards}
        onSelect={modals.handleCopyToBoard}
        onDismiss={() => modals.setCopySourceProfile(null)}
      />

      <TextPromptModal
        visible={modals.copyTargetBoard != null}
        title={`Copy to ${modals.copyTargetBoard?.name ?? 'board'}`}
        placeholder="Profile name"
        initialValue={modals.copySourceProfile ? `${modals.copySourceProfile.name} (copy)` : ''}
        confirmLabel="Copy"
        onConfirm={modals.handleCopyConfirm}
        onDismiss={() => {
          modals.setCopyTargetBoard(null)
          modals.setCopySourceProfile(null)
        }}
      />

      <ConfirmModal
        visible={modals.deleteConfirmProfile != null}
        title="Delete Profile"
        message={`Delete "${modals.deleteConfirmProfile?.name}"? This cannot be undone.`}
        confirmLabel="Delete"
        destructive
        onConfirm={() => {
          if (modals.deleteConfirmProfile)
            void modals.storeDeleteProfile(modals.deleteConfirmProfile.id)
          modals.setDeleteConfirmProfile(null)
        }}
        onCancel={() => modals.setDeleteConfirmProfile(null)}
      />
    </SafeAreaView>
  )
}

interface BasicSliderItemCellProps {
  item: BasicSliderItem
  editable: boolean
  fullWidth?: boolean
  onPress: (sliderId: string, ref: { current: View | null }) => void
  onResetFormula: () => void
}

function BasicSliderItemCell({
  item,
  editable,
  onPress,
  onResetFormula,
}: BasicSliderItemCellProps) {
  const cellRef = useRef<View | null>(null)
  return (
    <BasicSliderCell
      ref={cellRef}
      item={item}
      icon={basicSliderIcon(item.id)}
      color={basicSliderColor(item.id)}
      editable={editable}
      onPress={() => onPress(item.id, cellRef)}
      onResetFormula={onResetFormula}
    />
  )
}

interface TuneFieldCellProps {
  field: RefloatConfigField
  savedValue: TuneProfileFieldValue | undefined
  boardValue: TuneProfileFieldValue | undefined
  profileValue: TuneProfileFieldValue | undefined
  dirty: boolean
  boardChanged: boolean
  onPress: (field: RefloatConfigField, ref: { current: View | null }, color: string) => void
  onRevert: () => void
  onAcceptBoard: () => void
}

function TuneFieldCell({
  field,
  savedValue,
  boardValue,
  profileValue,
  dirty,
  boardChanged,
  onPress,
  onRevert,
  onAcceptBoard,
}: TuneFieldCellProps) {
  const cellRef = useRef<View | null>(null)
  const color = boardChanged ? theme.palette.green.color : theme.palette.sky.color
  return (
    <TuneConfigCell
      ref={cellRef}
      field={field}
      savedValue={savedValue}
      boardValue={boardValue}
      profileValue={profileValue}
      dirty={dirty}
      boardChanged={boardChanged}
      color={color}
      onPress={() => onPress(field, cellRef, color)}
      onRevert={onRevert}
      onAcceptBoard={onAcceptBoard}
    />
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.palette.slate.bg,
  },
  headerActions: {
    flexDirection: 'row',
    gap: 8,
  },
  headerTitle: {
    color: theme.palette.slate.textPrimary,
    fontSize: 17,
    fontWeight: '900',
  },
  headerPills: {
    marginHorizontal: 8,
  },
  headerPillsContent: {
    minWidth: 0,
    paddingHorizontal: 2,
  },
  mainState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 24,
  },
  firstProfileAction: {
    minWidth: 240,
  },
  stateText: {
    color: theme.palette.slate.textSecondary,
    fontSize: 15,
  },
  errorText: {
    color: theme.status.error.text,
    fontSize: 15,
    textAlign: 'center',
  },
  errorBanner: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    backgroundColor: theme.status.error.bg,
    borderColor: theme.status.error.border,
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
  },
  errorBannerText: {
    color: theme.status.error.text,
    flex: 1,
  },
  schemaMismatchBar: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.palette.yellow.border,
    backgroundColor: theme.palette.yellow.bg,
    padding: 12,
  },
  schemaMismatchTextWrap: {
    flex: 1,
    gap: 2,
  },
  schemaMismatchTitle: {
    color: theme.palette.yellow.text,
    fontSize: 13,
    fontWeight: '900',
  },
  schemaMismatchText: {
    color: theme.palette.yellow.color,
    fontSize: 11,
    fontWeight: '700',
  },
})
