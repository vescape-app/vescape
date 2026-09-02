import { useEffect } from 'react'

import {
  canRunFirmwareCommand,
  firmwareCommandBlockedMessage,
} from '@/modules/board/lib/boardLinkIntegrity'
import { useBleStore } from '@/modules/board/store/bleStore'
import { useSettingsStore } from '@/modules/settings/store/settingsStore'
import { startBoardMove, stopBoardMove } from 'vescape-core'

/** Full-scale Board Move input; strength is a percentage of it. */
const BOARD_MOVE_INPUT_MAX = 127

export const BOARD_MOVE_STRENGTH_MIN_PERCENT = 10
export const BOARD_MOVE_STRENGTH_MAX_PERCENT = 100
export const BOARD_MOVE_STRENGTH_STEP_PERCENT = 10

/**
 * Hold-to-move control over the board's motor. The board only acts on it while
 * disengaged (nobody on the pads), which is the firmware's own rule, and clamps
 * the requested strength with its own `remote.max_move_speed` /
 * `remote_throttle_current_max`.
 */
export function useBoardMoveControl() {
  const boardConnected = useBleStore((state) => state.status === 'connected')
  const linkIntegrity = useBleStore((state) => state.linkIntegrity)
  const canCommand = boardConnected && canRunFirmwareCommand(linkIntegrity)
  const strengthPercent = useSettingsStore((state) => state.boardMoveStrengthPercent)
  const setSetting = useSettingsStore((state) => state.set)

  const input = Math.round((BOARD_MOVE_INPUT_MAX * strengthPercent) / 100)

  // The native stream outlives this screen: without this, closing the drawer (or a JS reload)
  // mid-hold leaves the board rolling until the firmware's own ~1s timeout.
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
    // Unconditional: a release must stop the board even if the link just lost trust.
    stopMove: () => void stopBoardMove(),
  }
}
