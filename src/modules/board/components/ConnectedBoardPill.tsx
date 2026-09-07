import { forwardRef } from 'react'
import type { View } from 'react-native'
import { router } from 'expo-router'

import { BoardPill } from '@/modules/board/components/BoardPill'
import type { BoardIssues } from '@/modules/board/hooks/useBoardIssues'
import { useBleStore } from '@/modules/board/store/bleStore'
import type { Board } from '@/modules/board/store/boardStore'
import { showDevControls } from '@/config/env'
import { routes } from '@/navigation/routes'

interface ConnectedBoardPillProps {
  maxWidth: number
  activeBoard: Board | undefined
  bleStatus: string
  isReplay: boolean
  /** Pending trouble on the board, read once by the top bar and shared with the selector. */
  issues: BoardIssues
  warningTriggerRef: React.RefObject<View | null>
  faultTriggerRef: React.RefObject<View | null>
  onOpenWarnings: () => void
  onOpenFaults: () => void
  onOpenSelector: () => void
  onDisconnect: () => void
}

/** Store subscriptions and drawer intents stay outside the pill's presentation. */
export const ConnectedBoardPill = forwardRef<View, ConnectedBoardPillProps>(
  function ConnectedBoardPill(
    {
      activeBoard,
      isReplay,
      issues,
      warningTriggerRef,
      faultTriggerRef,
      onOpenWarnings,
      onOpenFaults,
      ...props
    },
    ref,
  ) {
    const recording = useBleStore((s) => s.recordDebugSession)
    const setRecording = useBleStore((s) => s.setRecordDebugSession)

    return (
      <BoardPill
        {...props}
        ref={ref}
        name={activeBoard?.name ?? null}
        replay={isReplay && showDevControls}
        onEdit={
          activeBoard
            ? () => router.push({ pathname: routes.editBoard, params: { boardId: activeBoard.id } })
            : undefined
        }
        onStopRecording={showDevControls && recording ? () => setRecording(false) : undefined}
        warning={
          issues.warningsEnabled && issues.severity
            ? { severity: issues.severity, ref: warningTriggerRef, onPress: onOpenWarnings }
            : undefined
        }
        fault={
          issues.faultsEnabled && issues.faultCount > 0
            ? { ref: faultTriggerRef, onPress: onOpenFaults }
            : undefined
        }
      />
    )
  },
)
