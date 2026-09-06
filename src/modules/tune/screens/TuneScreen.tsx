import { useIsFocused, useNavigation, useRouter } from 'expo-router'
import { CaretDownIcon, CaretUpIcon, WarningCircleIcon } from 'phosphor-react-native'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'

import { Button } from '@/components/base/Button'
import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'
import { TuneGroupGrid } from '@/modules/tune/components/TuneGroupGrid'
import { TunePreviewSection } from '@/modules/tune/components/TunePreviewSection'
import { TuneSyncBar } from '@/modules/tune/components/TuneSyncBar'
import { useTuneModals } from '@/modules/tune/hooks/useTuneModals'
import { useTuneScreenData } from '@/modules/tune/hooks/useTuneScreenData'
import { reportTuneCompatibilityIssue } from '@/modules/tune/lib/tuneCompatibilityReporting'
import { BasicSliderItemCell, TuneFieldCell } from '@/modules/tune/screens/TuneFieldCells'
import { TuneModalHost } from '@/modules/tune/screens/TuneModalHost'
import { TuneScreenHeader } from '@/modules/tune/screens/TuneScreenHeader'
import { TuneScreenStates } from '@/modules/tune/screens/TuneScreenStates'
import { useTuneProfileStore } from '@/modules/tune/store/tuneProfileStore'
import { routes } from '@/navigation/routes'

/** Edits the active Tune Profile: basic sliders, advanced field groups, and the sync bar. */
export function TuneScreen() {
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
  const [advancedSettingsVisible, setAdvancedSettingsVisible] = useState(false)
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
      header: () => (
        <TuneScreenHeader
          paddingTop={Math.max(insets.top, 8)}
          profiles={profiles}
          activeProfile={activeProfile}
          boardConnected={boardConnected}
          boardSnapshotStatus={boardSnapshotStatus}
          firmwareCommandsTrusted={firmwareCommandsTrusted}
          modals={modals}
          onSelectProfile={setActiveProfile}
          onOpenHistory={openHistory}
          onReadBoard={() => void loadOnline()}
        />
      ),
    })
  }, [
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
        onCreateFirstProfile={() => void modals.storeCreateProfile('Main', '', '')}
      />

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

        <View style={styles.advancedSettingsToggle}>
          <Button
            label={advancedSettingsVisible ? 'Hide advanced settings' : 'Show advanced settings'}
            icon={advancedSettingsVisible ? CaretUpIcon : CaretDownIcon}
            iconPosition="right"
            variant="secondary"
            size="sm"
            onPress={() => setAdvancedSettingsVisible((visible) => !visible)}
          />
        </View>

        {advancedSettingsVisible
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
      <TuneModalHost modals={modals} />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.neutral.bg,
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
  advancedSettingsToggle: {
    alignItems: 'center',
  },
})
