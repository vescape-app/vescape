import { useState } from 'react'
import { Alert, Linking, Platform, ScrollView, StyleSheet, Switch } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import {
  BluetoothConnectedIcon,
  ClockCountdownIcon,
  FlagCheckeredIcon,
  PowerIcon,
  RecordIcon,
  SpeakerHighIcon,
} from 'phosphor-react-native'
import { useShallow } from 'zustand/react/shallow'

import { theme } from '@/constants/theme'
import { SettingsCard } from '@/components/settings/SettingsCard'
import { SettingsRow } from '@/components/settings/SettingsRow'
import { Stepper } from '@/components/forms/Stepper'
import { IconHero } from '@/components/settings/IconHero'
import { SettingsSectionTitle } from '@/components/settings/SettingsSectionTitle'
import { ConfirmModal } from '@/components/modals/ConfirmModal'
import { useBleStore } from '@/modules/board/store/bleStore'
import {
  connectionPauseReason,
  connectionPauseRemaining,
  isConnectionPauseActive,
} from '@/modules/board/lib/connectionPause'
import { useBoardStore } from '@/modules/board/store/boardStore'
import { useSettingsStore } from '@/modules/settings/store/settingsStore'
import { AutoStartCard } from '@/modules/settings/components/AutoStartCard'
import { ConnectionPausedCard } from '@/modules/settings/components/ConnectionPausedCard'
import { companionErrorMessage } from '@/modules/settings/lib/companionErrors'
import {
  ensureBackgroundLocation,
  hasBackgroundLocation,
} from '@/modules/settings/hooks/usePermissions'

/** Cap offered for *new* pause durations. Migrated legacy values above it stay valid. */
const PAUSE_MAX_MINUTES = 480

const pauseStep = (value: number, direction: 1 | -1) =>
  direction === 1 ? (value < 10 ? 5 : 15) : value <= 10 ? 5 : 15

/** Backing out of the system device chooser is normal — only real failures get an alert. */
const alertCompanionError = (error: unknown, fallback: string) => {
  const message = companionErrorMessage(error, fallback)
  if (message) Alert.alert('Auto start app', message)
}

export default function ConnectionSettingsScreen() {
  const {
    autoConnect,
    autoRecording,
    rideSummaryNotificationsEnabled,
    companionPresenceEnabled,
    companionPresenceBoards,
    automaticConnectionPauseMinutes,
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
      rideSummaryNotificationsEnabled: s.rideSummaryNotificationsEnabled,
      companionPresenceEnabled: s.companionPresenceEnabled,
      companionPresenceBoards: s.companionPresenceBoards,
      automaticConnectionPauseMinutes: s.automaticConnectionPauseMinutes,
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
  const linkedBoards = boards
    .filter((board) => board.link)
    .map((board) => ({ id: board.id, name: board.name, bleId: board.link!.bleId }))

  const connectedBoardId = useBleStore((s) => (s.status === 'idle' ? null : s.selectedBoardId))
  const connectionPause = useBleStore((s) => s.connectionPause)
  const connect = useBleStore((s) => s.connect)
  const [connectingPaused, setConnectingPaused] = useState(false)
  // Native owns expiry; this screen only renders whatever the last snapshot said.
  const activePause = isConnectionPauseActive(connectionPause, Date.now()) ? connectionPause : null
  const pausedBoardName =
    boards.find((board) => board.id === activePause?.boardId)?.name ?? 'Your board'

  /** **Connect now** is an explicit Connect: native clears the pause before the session starts. */
  const onConnectNow = async (boardId: string) => {
    setConnectingPaused(true)
    try {
      await connect(boardId)
    } catch (error) {
      console.warn('Connect now failed', error)
    } finally {
      setConnectingPaused(false)
    }
  }

  const [bgLocationPrompt, setBgLocationPrompt] = useState(false)
  const [disconnectPrompt, setDisconnectPrompt] = useState(false)
  const [pendingBoardId, setPendingBoardId] = useState<string | null>(null)
  const [busyBoardId, setBusyBoardId] = useState<string | null>(null)
  const [masterBusy, setMasterBusy] = useState(false)

  const onCompanionToggle = async (enabled: boolean) => {
    setMasterBusy(true)
    try {
      await setCompanionPresence(enabled)
    } catch (error) {
      console.warn('Companion presence toggle failed', error)
      alertCompanionError(error, 'Could not change auto start')
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
      alertCompanionError(error, 'Could not enable auto start')
    } finally {
      setBusyBoardId(null)
      setPendingBoardId(null)
    }
  }

  /** Runs the permission gate, then hands the board to native (which opens the Android chooser). */
  const continueEnable = async (boardId: string) => {
    // Hands-off auto-start records GPS only with "Allow all the time": the OS starts the service
    // from the background and withholds while-in-use location. Explain why before any grant attempt.
    if (await hasBackgroundLocation()) {
      void enableCompanion(boardId)
    } else {
      setPendingBoardId(boardId)
      setBgLocationPrompt(true)
    }
  }

  const onAddCompanionBoard = async (boardId: string) => {
    // Android can only pair with a board it can scan, so native drops a live session first. Say so
    // up front — an unannounced disconnect mid-ride reads like a bug.
    if (boardId === connectedBoardId) {
      setPendingBoardId(boardId)
      setDisconnectPrompt(true)
      return
    }
    await continueEnable(boardId)
  }

  const onRemoveCompanionBoard = async (boardId: string) => {
    setBusyBoardId(boardId)
    try {
      await removeCompanionBoard(boardId)
    } catch (error) {
      console.warn('Companion presence removal failed', error)
      alertCompanionError(error, 'Could not turn this board off')
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
      // Grant happens outside the app, so this attempt is over — the rider taps Enable again.
      setPendingBoardId(null)
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
          <AutoStartCard
            enabled={companionPresenceEnabled}
            boards={linkedBoards}
            armedBoardIds={companionPresenceBoards.map((board) => board.boardId)}
            busyBoardId={busyBoardId}
            masterBusy={masterBusy}
            onToggle={(enabled) => void onCompanionToggle(enabled)}
            onEnableBoard={(boardId) => void onAddCompanionBoard(boardId)}
            onDisableBoard={(boardId) => void onRemoveCompanionBoard(boardId)}
          />
        ) : null}

        {activePause ? (
          <ConnectionPausedCard
            boardName={pausedBoardName}
            remaining={connectionPauseRemaining(activePause.until, Date.now())}
            reason={connectionPauseReason(activePause.source)}
            busy={connectingPaused}
            onConnectNow={() => void onConnectNow(activePause.boardId)}
          />
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
            icon={ClockCountdownIcon}
            iconColor={theme.palette.orange.color}
            label="Pause after you stop"
            hint="How long disconnecting, ending a ride, or closing the app keeps auto connect off"
            right={
              <Stepper
                value={automaticConnectionPauseMinutes}
                unit="min"
                min={0}
                max={PAUSE_MAX_MINUTES}
                step={pauseStep}
                onChange={(next) => {
                  // A legacy value above the recommended cap stays valid until the rider steps it
                  // down; only new selections are capped.
                  const clamped = Math.max(
                    0,
                    Math.min(Math.max(PAUSE_MAX_MINUTES, automaticConnectionPauseMinutes), next),
                  )
                  if (clamped !== automaticConnectionPauseMinutes) {
                    void set('automaticConnectionPauseMinutes', clamped)
                  }
                }}
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
            icon={FlagCheckeredIcon}
            label="Ride summaries"
            hint="Silent notification with distance, time and battery after a ride"
            right={
              <Switch
                value={rideSummaryNotificationsEnabled}
                onValueChange={(v) => void set('rideSummaryNotificationsEnabled', v)}
                trackColor={{ false: theme.palette.slate.border, true: theme.palette.sky.border }}
                thumbColor={
                  rideSummaryNotificationsEnabled
                    ? theme.palette.sky.color
                    : theme.palette.slate.textMuted
                }
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
        visible={disconnectPrompt}
        title="Board will disconnect"
        message={
          'Android pairs with a board by scanning for it, which only works while nothing is ' +
          'connected. Your board disconnects for a moment, then reconnects once auto start is set up.'
        }
        confirmLabel="Continue"
        cancelLabel="Not now"
        onConfirm={() => {
          setDisconnectPrompt(false)
          if (pendingBoardId) void continueEnable(pendingBoardId)
        }}
        onCancel={() => {
          setDisconnectPrompt(false)
          setPendingBoardId(null)
        }}
      />
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
