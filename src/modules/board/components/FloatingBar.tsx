import { router } from 'expo-router'
import { PauseIcon, RecordIcon, StopIcon } from 'phosphor-react-native'
import { useCallback } from 'react'
import { isReplayBoardId, type LinkIntegrity } from 'vescape-core'
import { useShallow } from 'zustand/react/shallow'

import {
  FloatingActionPill,
  FloatingBarFrame,
  FloatingStatusPill,
  type FloatingStatusPillModel,
} from '@/components/controls/FloatingBar'
import { routes } from '@/navigation/routes'
import { AlternativeHintPill } from '@/modules/board/components/AlternativeHintPill'
import { showDevControls } from '@/config/env'
import type { Board } from '@/modules/board/store/boardStore'
import { useBleStore } from '@/modules/board/store/bleStore'
import { getConnectedLinkIntegrityWarning } from '@/modules/board/lib/boardLinkIntegrity'
import { theme } from '@/constants/theme'

interface FloatingBarProps {
  bleStatus: string
  activeBoard: Board | undefined
  onStopScan: () => void
  onRetryConnect: () => void
  bottomOffset?: number
}

const ALERT_CONFIG = {
  warning: {
    bg: theme.status.warning.bg,
    border: theme.status.warning.border,
    text: theme.status.warning.text,
    btnBg: theme.status.warning.color,
  },
  error: {
    bg: theme.status.error.bg,
    border: theme.status.error.border,
    text: theme.status.error.text,
    btnBg: theme.status.error.color,
  },
  upgrade: {
    bg: theme.status.upgrade.bg,
    border: theme.status.upgrade.border,
    text: theme.status.upgrade.text,
    btnBg: theme.status.upgrade.color,
  },
} as const

interface SpinnerPill {
  kind: 'spinner'
  text: string
  color: string
  onPress: () => void
}
interface ActionPill {
  kind: 'action'
  text: string
  buttonText: string
  config: (typeof ALERT_CONFIG)[keyof typeof ALERT_CONFIG]
  onPress: () => void
}
type StatusPill = SpinnerPill | ActionPill

function canToggleRecording(status: string): boolean {
  return status === 'connected'
}

function getStatusPill(
  status: string,
  scanStatus: string,
  linkIntegrity: LinkIntegrity,
  isReplay: boolean,
  board: Board | undefined,
  onStopScan: () => void,
  onRetryConnect: () => void,
): StatusPill | null {
  if (!board)
    return {
      kind: 'action',
      text: 'No board added',
      buttonText: 'Add',
      config: ALERT_CONFIG.warning,
      onPress: () => router.push(routes.addBoard),
    }
  if (!board.link)
    return {
      kind: 'action',
      text: 'Board not linked',
      buttonText: 'Link',
      config: ALERT_CONFIG.warning,
      onPress: () => router.push({ pathname: routes.addBoardScan, params: { boardId: board.id } }),
    }
  if (scanStatus === 'scanning' && status === 'idle')
    return {
      kind: 'spinner',
      text: 'Searching…',
      color: theme.palette.sky.color,
      onPress: onStopScan,
    }
  if (status === 'discovering')
    return {
      kind: 'spinner',
      text: 'Discovering…',
      color: theme.palette.sky.color,
      onPress: onStopScan,
    }
  if (status === 'subscribing')
    return {
      kind: 'spinner',
      text: 'Subscribing…',
      color: theme.palette.sky.color,
      onPress: onStopScan,
    }
  if (status === 'waiting_for_telemetry')
    return {
      kind: 'spinner',
      text: 'Waiting for telemetry…',
      color: theme.palette.sky.color,
      onPress: onStopScan,
    }
  if (status === 'reconnecting')
    return {
      kind: 'spinner',
      text: 'Reconnecting…',
      color: theme.palette.sky.color,
      onPress: onStopScan,
    }
  if (status === 'rescanning')
    return {
      kind: 'spinner',
      text: 'Searching…',
      color: theme.palette.sky.color,
      onPress: onStopScan,
    }
  if (status === 'disconnecting')
    return {
      kind: 'spinner',
      text: 'Disconnecting…',
      color: theme.palette.sky.color,
      onPress: onStopScan,
    }
  if (status === 'connecting')
    return {
      kind: 'spinner',
      text: 'Connecting…',
      color: theme.palette.sky.color,
      onPress: onStopScan,
    }
  // A replay session streams a real board's recorded frames, so link-integrity checks compare the
  // recording against the saved link and can read as outdated/mismatched. Suppress the pill: the
  // "Re-link" CTA is inapplicable in dev playback (it would overwrite the real board's trusted link
  // with replay-derived data and route to editBoardLink with a synthetic replay board id).
  const linkWarning = isReplay ? null : getConnectedLinkIntegrityWarning(status, linkIntegrity)
  if (linkWarning)
    return {
      kind: 'action',
      text: linkWarning.text,
      buttonText: linkWarning.buttonText,
      config: ALERT_CONFIG.upgrade,
      onPress: () => router.push({ pathname: routes.editBoardLink, params: { boardId: board.id } }),
    }
  if (status === 'stale')
    return {
      kind: 'spinner',
      text: 'Telemetry stale',
      color: theme.status.error.color,
      onPress: onStopScan,
    }
  if (status === 'idle')
    return {
      kind: 'action',
      text: 'Board not connected',
      buttonText: 'Connect',
      config: ALERT_CONFIG.warning,
      onPress: onRetryConnect,
    }
  if (status === 'error')
    return {
      kind: 'action',
      text: 'Connection failed',
      buttonText: 'Retry',
      config: ALERT_CONFIG.error,
      onPress: onRetryConnect,
    }
  return null
}

export function FloatingBar({
  bleStatus,
  activeBoard,
  onStopScan,
  onRetryConnect,
  bottomOffset = 16,
}: FloatingBarProps) {
  const { recording, paused, scanStatus, linkIntegrity, isReplay, start, stop } = useBleStore(
    useShallow((s) => ({
      recording: s.telemetryRecordingEnabled,
      paused: s.telemetryRecordingPaused,
      scanStatus: s.scanStatus,
      linkIntegrity: s.linkIntegrity,
      isReplay: isReplayBoardId(s.connectedId),
      start: s.startTelemetryRecording,
      stop: s.stopTelemetryRecording,
    })),
  )

  const toggleRecord = useCallback(() => {
    if (!recording && !canToggleRecording(bleStatus)) return
    if (recording) {
      stop()
    } else {
      start()
    }
  }, [bleStatus, recording, start, stop])

  const pill = getStatusPill(
    bleStatus,
    scanStatus,
    linkIntegrity,
    isReplay,
    activeBoard,
    onStopScan,
    onRetryConnect,
  )
  const uiPill: FloatingStatusPillModel | null =
    pill?.kind === 'spinner'
      ? {
          kind: 'spinner',
          text: pill.text,
          color: pill.color,
          onPress: pill.onPress,
          testID: 'floating-bar-status',
          cancelTestID: 'floating-bar-cancel',
        }
      : pill
        ? {
            kind: 'action',
            text: pill.text,
            buttonText: pill.buttonText,
            bg: pill.config.bg,
            border: pill.config.border,
            textColor: pill.config.text,
            buttonBg: pill.config.btnBg,
            onPress: pill.onPress,
            testID: 'floating-bar-connect',
          }
        : null

  return (
    <FloatingBarFrame bottomOffset={bottomOffset}>
      {/* A nearby linked Board the rider may switch to. Product surface, not rider tooling, so it is
          not behind the dev-controls gate — and it renders above the status pill because it is an
          offer to answer rather than a state to read. */}
      <AlternativeHintPill />
      {/* Connection state — "No board added", "Connecting…", link warnings — is rider tooling that
          only appears when something is wrong or in flight. None of it belongs in a store frame. */}
      {uiPill && showDevControls ? <FloatingStatusPill pill={uiPill} /> : null}
      {/* The REC control is rider tooling, not product surface — a store screenshot shows the ride,
          not the capture affordance. */}
      {showDevControls && (
        <FloatingActionPill
          icon={recording ? (paused ? PauseIcon : StopIcon) : RecordIcon}
          label={recording ? (paused ? 'PAUSED' : 'STOP') : 'REC'}
          active={recording}
          paused={paused}
          disabled={!recording && !canToggleRecording(bleStatus)}
          onPress={toggleRecord}
          testID="floating-bar-record"
        />
      )}
    </FloatingBarFrame>
  )
}
