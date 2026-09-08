import type { View } from 'react-native'
import { EngineIcon, WarningDiamondIcon } from 'phosphor-react-native'

import { BoardWarningsSheet } from '@/modules/board/components/BoardWarningsSheet'
import { VescFaultsSheet } from '@/modules/board/components/VescFaultsSheet'
import { EdgeDrawer } from '@/components/overlays/EdgeDrawer'
import { severityStatus } from '@/modules/board/constants/boardWarnings'
import type { BoardIssues } from '@/modules/board/hooks/useBoardIssues'
import { theme } from '@/constants/theme'

interface BoardIssueDrawersProps {
  issues: BoardIssues
  activeBoardId: string | null
  sessionBoardId: string | null
  warningsOpen: boolean
  faultsOpen: boolean
  warningTriggerRef: React.RefObject<View | null>
  faultTriggerRef: React.RefObject<View | null>
  onCloseWarnings: () => void
  onCloseFaults: () => void
}

/**
 * The two trouble drawers, mounted once above every surface that can open them — the pill badges
 * and the board selector's links strip both point here rather than owning a copy.
 */
export function BoardIssueDrawers({
  issues,
  activeBoardId,
  sessionBoardId,
  warningsOpen,
  faultsOpen,
  warningTriggerRef,
  faultTriggerRef,
  onCloseWarnings,
  onCloseFaults,
}: BoardIssueDrawersProps) {
  return (
    <>
      {issues.warningsEnabled && activeBoardId && (
        <EdgeDrawer
          visible={warningsOpen}
          triggerRef={warningTriggerRef}
          title="Warnings"
          icon={EngineIcon}
          iconColor={severityStatus(issues.severity ?? 'warn').color}
          onClose={onCloseWarnings}
        >
          <BoardWarningsSheet boardId={activeBoardId} warnings={issues.warnings} />
        </EdgeDrawer>
      )}
      {issues.faultsEnabled && sessionBoardId && (
        <EdgeDrawer
          visible={faultsOpen}
          triggerRef={faultTriggerRef}
          title="VESC faults"
          icon={WarningDiamondIcon}
          iconColor={theme.status.caution.color}
          onClose={onCloseFaults}
        >
          <VescFaultsSheet
            key={sessionBoardId}
            boardId={sessionBoardId}
            faults={issues.faults}
            visible={faultsOpen}
          />
        </EdgeDrawer>
      )}
    </>
  )
}
