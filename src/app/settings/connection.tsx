import { useState } from 'react'
import { Alert, Linking, Platform, ScrollView, StyleSheet, Switch } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import {
  BluetoothConnectedIcon,
  ClockCountdownIcon,
  PlusIcon,
  PowerIcon,
  RecordIcon,
  RocketLaunchIcon,
  SpeakerHighIcon,
  TrashIcon,
} from 'phosphor-react-native'
import { useShallow } from 'zustand/react/shallow'

import { theme } from '@/constants/theme'
import { SettingsCard } from '@/components/settings/SettingsCard'
import { SettingsRow } from '@/components/settings/SettingsRow'
import { Stepper } from '@/components/forms/Stepper'
import { IconHero } from '@/components/settings/IconHero'
import { SettingsSectionTitle } from '@/components/settings/SettingsSectionTitle'
import { ConfirmModal } from '@/components/modals/ConfirmModal'
import { FadeCardModal } from '@/components/modals/FadeCardModal'
import { IconButton } from '@/components/base/IconButton'
import { useBoardStore } from '@/modules/board/store/boardStore'
import { useSettingsStore } from '@/modules/settings/store/settingsStore'
import {
  ensureBackgroundLocation,
  hasBackgroundLocation,
} from '@/modules/settings/hooks/usePermissions'

export default function ConnectionSettingsScreen() {
  const {
    autoConnect,
    autoRecording,
    companionPresenceEnabled,
    companionPresenceBoards,
    companionPresenceCooldownMinutes,
    connectionSoundsEnabled,
    autoCloseEnabled,
    autoCloseDelayMinutes,
    set,
    setCompanionPresence,
    addCompanionBoard,
    removeCompanionBoard,
  } = useSettingsStore(
    useShallow((s) => ({
      autoConnect: s.autoConnect,
      autoRecording: s.autoRecording,
      companionPresenceEnabled: s.companionPresenceEnabled,
      companionPresenceBoards: s.companionPresenceBoards,
      companionPresenceCooldownMinutes: s.companionPresenceCooldownMinutes,
      connectionSoundsEnabled: s.connectionSoundsEnabled,
      autoCloseEnabled: s.autoCloseEnabled,
      autoCloseDelayMinutes: s.autoCloseDelayMinutes,
      set: s.set,
      setCompanionPresence: s.setCompanionPresence,
      addCompanionBoard: s.addCompanionBoard,
      removeCompanionBoard: s.removeCompanionBoard,
    })),
  )
  const boards = useBoardStore((s) => s.boards)
  const availableAutoStartBoards = boards.filter(
    (board) =>
      board.link && !companionPresenceBoards.some((enabled) => enabled.boardId === board.id),
  )

  const [bgLocationPrompt, setBgLocationPrompt] = useState(false)
  const [boardPickerVisible, setBoardPickerVisible] = useState(false)
  const [pendingBoardId, setPendingBoardId] = useState<string | null>(null)
  const [busyBoardId, setBusyBoardId] = useState<string | null>(null)
  const [masterBusy, setMasterBusy] = useState(false)

  const onCompanionToggle = async (enabled: boolean) => {
    setMasterBusy(true)
    try {
      await setCompanionPresence(enabled)
      if (
        enabled &&
        useSettingsStore.getState().companionPresenceBoards.length === 0 &&
        availableAutoStartBoards.length > 0
      ) {
        setBoardPickerVisible(true)
      }
    } catch (error) {
      console.warn('Companion presence toggle failed', error)
      Alert.alert(
        'Auto start app',
        error instanceof Error ? error.message : 'Could not change auto start',
      )
    } finally {
      setMasterBusy(false)
    }
  }

  const enableCompanion = async (boardId: string) => {
    setBusyBoardId(boardId)
    try {
      await addCompanionBoard(boardId)
    } catch (error) {
      console.warn('Companion presence toggle failed', error)
      Alert.alert(
        'Auto start app',
        error instanceof Error ? error.message : 'Could not enable auto start',
      )
    } finally {
      setBusyBoardId(null)
      setPendingBoardId(null)
    }
  }

  const onAddCompanionBoard = async (boardId: string) => {
    setBoardPickerVisible(false)
    // Hands-off auto-start records GPS only with "Allow all the time": the OS starts the service
    // from the background and withholds while-in-use location. Explain why before any grant attempt.
    if (await hasBackgroundLocation()) {
      void enableCompanion(boardId)
    } else {
      setPendingBoardId(boardId)
      setBgLocationPrompt(true)
    }
  }

  const onRemoveCompanionBoard = async (boardId: string) => {
    setBusyBoardId(boardId)
    try {
      await removeCompanionBoard(boardId)
    } catch (error) {
      console.warn('Companion presence removal failed', error)
      Alert.alert(
        'Auto start app',
        error instanceof Error ? error.message : 'Could not remove auto-start board',
      )
    } finally {
      setBusyBoardId(null)
    }
  }

  const onBgLocationConfirm = async () => {
    setBgLocationPrompt(false)
    // Android 10 grants inline; Android 11+ removed the dialog, so fall back to Settings.
    if ((await ensureBackgroundLocation()) && pendingBoardId) {
      void enableCompanion(pendingBoardId)
    } else {
      Linking.openSettings()
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <IconHero
          icon={BluetoothConnectedIcon}
          description="Choose how the app wakes up, connects to your board, and reacts when the board connects."
        />

        {Platform.OS === 'android' ? (
          <>
            <SettingsSectionTitle>Wake up</SettingsSectionTitle>
            <SettingsCard>
              <SettingsRow
                icon={RocketLaunchIcon}
                iconColor={
                  companionPresenceEnabled
                    ? theme.palette.green.color
                    : theme.palette.slate.textMuted
                }
                label="Auto start app"
                hint="Start the app when one of your configured boards appears"
                right={
                  <Switch
                    value={companionPresenceEnabled}
                    disabled={masterBusy}
                    onValueChange={(enabled) => void onCompanionToggle(enabled)}
                    trackColor={{
                      false: theme.palette.slate.border,
                      true: theme.palette.sky.border,
                    }}
                    thumbColor={
                      companionPresenceEnabled
                        ? theme.palette.sky.color
                        : theme.palette.slate.textMuted
                    }
                  />
                }
              />
              {companionPresenceEnabled && companionPresenceBoards.length === 0 ? (
                <SettingsRow
                  icon={RocketLaunchIcon}
                  iconColor={theme.palette.slate.textMuted}
                  label="No auto-start boards"
                  hint="Add a linked board to start the app when it appears"
                />
              ) : companionPresenceEnabled ? (
                companionPresenceBoards.map((board) => (
                  <SettingsRow
                    key={board.boardId}
                    icon={RocketLaunchIcon}
                    iconColor={theme.palette.green.color}
                    label={board.name}
                    hint={board.bleId}
                    right={
                      <IconButton
                        icon={TrashIcon}
                        destructive
                        loading={busyBoardId === board.boardId}
                        accessibilityLabel={`Remove ${board.name} from auto start`}
                        onPress={() => void onRemoveCompanionBoard(board.boardId)}
                      />
                    }
                  />
                ))
              ) : null}
              {companionPresenceEnabled ? (
                <SettingsRow
                  icon={PlusIcon}
                  iconColor={theme.palette.sky.color}
                  label="Add board"
                  hint={
                    availableAutoStartBoards.length > 0
                      ? 'Choose another linked board'
                      : 'No linked boards available'
                  }
                  onPress={
                    availableAutoStartBoards.length > 0
                      ? () => setBoardPickerVisible(true)
                      : undefined
                  }
                />
              ) : null}
              {companionPresenceEnabled ? (
                <SettingsRow
                  icon={ClockCountdownIcon}
                  iconColor={theme.palette.amber.color}
                  label="Don't restart for"
                  hint="After you exit the app, wait this long before auto starting again. 0 = off"
                  right={
                    <Stepper
                      value={companionPresenceCooldownMinutes}
                      unit="min"
                      min={0}
                      max={480}
                      step={(v, dir) => (dir === 1 ? (v < 60 ? 15 : 30) : v <= 60 ? 15 : 30)}
                      onChange={(nextValue) => {
                        const clampedValue = Math.min(480, Math.max(0, nextValue))
                        if (clampedValue !== companionPresenceCooldownMinutes) {
                          void set('companionPresenceCooldownMinutes', clampedValue)
                        }
                      }}
                    />
                  }
                />
              ) : null}
            </SettingsCard>
          </>
        ) : null}

        <SettingsSectionTitle>Connection</SettingsSectionTitle>
        <SettingsCard>
          <SettingsRow
            icon={BluetoothConnectedIcon}
            iconColor={theme.palette.cyan.color}
            label="Auto connect"
            hint={
              companionPresenceEnabled
                ? 'Required by Auto start app'
                : 'Connect to your board when the app opens'
            }
            right={
              <Switch
                value={autoConnect}
                disabled={companionPresenceEnabled}
                onValueChange={(v) => void set('autoConnect', v)}
                trackColor={{
                  false: theme.palette.slate.border,
                  true: companionPresenceEnabled
                    ? theme.palette.slate.border
                    : theme.palette.sky.border,
                }}
                thumbColor={
                  companionPresenceEnabled
                    ? theme.palette.slate.textMuted
                    : autoConnect
                      ? theme.palette.sky.color
                      : theme.palette.slate.textMuted
                }
              />
            }
          />
          <SettingsRow
            icon={RecordIcon}
            iconWeight="fill"
            iconColor={theme.status.error.color}
            label="Auto recording"
            hint="Start recording when board connects"
            right={
              <Switch
                value={autoRecording}
                onValueChange={(v) => void set('autoRecording', v)}
                trackColor={{ false: theme.palette.slate.border, true: theme.palette.sky.border }}
                thumbColor={autoRecording ? theme.palette.sky.color : theme.palette.slate.textMuted}
              />
            }
          />
          <SettingsRow
            icon={SpeakerHighIcon}
            iconColor={theme.palette.cyan.color}
            label="Connection sounds"
            hint="Play on/off sounds on connect and dropout"
            right={
              <Switch
                value={connectionSoundsEnabled}
                onValueChange={(v) => void set('connectionSoundsEnabled', v)}
                trackColor={{ false: theme.palette.slate.border, true: theme.palette.sky.border }}
                thumbColor={
                  connectionSoundsEnabled ? theme.palette.sky.color : theme.palette.slate.textMuted
                }
              />
            }
          />
        </SettingsCard>

        {Platform.OS === 'android' ? (
          <>
            <SettingsSectionTitle>Shutdown</SettingsSectionTitle>
            <SettingsCard>
              <SettingsRow
                icon={PowerIcon}
                iconColor={theme.palette.orange.color}
                label="Auto close app"
                hint="Close the app when the board stays disconnected"
                right={
                  <Switch
                    value={autoCloseEnabled}
                    onValueChange={(v) => void set('autoCloseEnabled', v)}
                    trackColor={{
                      false: theme.palette.slate.border,
                      true: theme.palette.sky.border,
                    }}
                    thumbColor={
                      autoCloseEnabled ? theme.palette.sky.color : theme.palette.slate.textMuted
                    }
                  />
                }
              />
              {autoCloseEnabled ? (
                <SettingsRow
                  icon={ClockCountdownIcon}
                  iconColor={theme.palette.orange.color}
                  label="Close after"
                  hint="Time without a board connection before the app closes itself"
                  right={
                    <Stepper
                      value={autoCloseDelayMinutes}
                      unit="min"
                      min={1}
                      max={480}
                      step={(v, dir) =>
                        dir === 1
                          ? v < 5
                            ? 1
                            : v < 20
                              ? 5
                              : v < 60
                                ? 10
                                : 30
                          : v <= 5
                            ? 1
                            : v <= 20
                              ? 5
                              : v <= 60
                                ? 10
                                : 30
                      }
                      onChange={(nextValue) => {
                        const clampedValue = Math.min(480, Math.max(1, nextValue))
                        if (clampedValue !== autoCloseDelayMinutes) {
                          void set('autoCloseDelayMinutes', clampedValue)
                        }
                      }}
                    />
                  }
                />
              ) : null}
            </SettingsCard>
          </>
        ) : null}
      </ScrollView>
      <ConfirmModal
        visible={bgLocationPrompt}
        title="Allow location all the time"
        message={
          'Auto start wakes the app and records your ride while the phone is in your pocket. ' +
          'Android only sends GPS to a background-started app when location is set to “Allow all ' +
          'the time”. Without it, these rides have no GPS track.'
        }
        confirmLabel="Continue"
        cancelLabel="Not now"
        onConfirm={onBgLocationConfirm}
        onCancel={() => setBgLocationPrompt(false)}
      />
      <FadeCardModal
        visible={boardPickerVisible}
        title="Add auto-start board"
        titleIcon={RocketLaunchIcon}
        onDismiss={() => setBoardPickerVisible(false)}
      >
        <SettingsCard>
          {availableAutoStartBoards.map((board) => (
            <SettingsRow
              key={board.id}
              icon={BluetoothConnectedIcon}
              iconColor={theme.palette.cyan.color}
              label={board.name}
              hint={board.link?.bleId}
              onPress={() => void onAddCompanionBoard(board.id)}
            />
          ))}
        </SettingsCard>
      </FadeCardModal>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.palette.slate.bg,
  },
  content: {
    padding: 16,
    gap: 8,
  },
})
