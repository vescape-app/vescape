import { forwardRef } from 'react'
import type { View } from 'react-native'

import { BoardPill, type BoardPillAccessory } from '@/modules/board/components/BoardPill'
import type { BoardIssues } from '@/modules/board/hooks/useBoardIssues'
import { useBleStore } from '@/modules/board/store/bleStore'
import type { Board } from '@/modules/board/store/boardStore'
import { showDevControls } from '@/config/env'

interface ConnectedBoardPillProps {
  maxWidth: number
  activeBoard: Board | undefined
  bleStatus: string
  issues: BoardIssues
  warningTriggerRef: React.RefObject<View | null>
  faultTriggerRef: React.RefObject<View | null>
  onOpenWarnings: () => void
  onOpenFaults: () => void
  onOpenSelector: () => void
  onDisconnect: () => void
  onConnect?: () => void
  accessory?: BoardPillAccessory
}

export const ConnectedBoardPill = forwardRef<View, ConnectedBoardPillProps>(
  function ConnectedBoardPill(
    {
      activeBoard,
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
