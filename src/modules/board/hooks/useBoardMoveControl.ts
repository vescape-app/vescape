import { useEffect } from 'react'

import {
  canRunFirmwareCommand,
  firmwareCommandBlockedMessage,
} from '@/modules/board/lib/boardLinkIntegrity'
import { useBleStore } from '@/modules/board/store/bleStore'
import { useSettingsStore } from '@/modules/settings/store/settingsStore'
import { startBoardMove, stopBoardMove } from 'vescape-core'

const BOARD_MOVE_INPUT_MAX = 127

export const BOARD_MOVE_STRENGTH_MIN_PERCENT = 10
export const BOARD_MOVE_STRENGTH_MAX_PERCENT = 100
export const BOARD_MOVE_STRENGTH_STEP_PERCENT = 10

export function useBoardMoveControl() {
  const boardConnected = useBleStore((state) => state.status === 'connected')
  const linkIntegrity = useBleStore((state) => state.linkIntegrity)
  const canCommand = boardConnected && canRunFirmwareCommand(linkIntegrity)
  const strengthPercent = useSettingsStore((state) => state.boardMoveStrengthPercent)
  const setSetting = useSettingsStore((state) => state.set)

  const input = Math.round((BOARD_MOVE_INPUT_MAX * strengthPercent) / 100)

  useEffect(() => () => void stopBoardMove(), [])

  return {
    boardConnected,
    canCommand,
    blockedMessage:
      boardConnected && !canCommand ? firmwareCommandBlockedMessage(linkIntegrity) : null,
    strengthPercent,
    setStrengthPercent: (percent: number) => {
      const clamped = Math.min(
        BOARD_MOVE_STRENGTH_MAX_PERCENT,
        Math.max(BOARD_MOVE_STRENGTH_MIN_PERCENT, percent),
      )
      if (clamped !== strengthPercent) void setSetting('boardMoveStrengthPercent', clamped)
    },
    moveForward: () => {
      if (canCommand) void startBoardMove(input)
    },
    moveBackward: () => {
      if (canCommand) void startBoardMove(-input)
    },
    stopMove: () => void stopBoardMove(),
  }
}
