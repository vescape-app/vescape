import { useMemo } from 'react'
import type { BoardWarning, BoardWarningSeverity, VescFaultOccurrence } from 'vescape-core'

import { pendingWarnings, worstSeverity } from '@/modules/board/lib/boardWarnings'
import { indicatorFaults } from '@/modules/board/lib/vescFaults'
import { EMPTY_WARNINGS, useBoardWarningsStore } from '@/modules/board/store/boardWarningsStore'
import { EMPTY_FAULTS, useVescFaultsStore } from '@/modules/board/store/vescFaultsStore'
import { useBoardStore } from '@/modules/board/store/boardStore'
import { useSettingsStore } from '@/modules/settings/store/settingsStore'

export interface BoardIssues {
  /** Every warning on the board, dismissed ones included — the sheet grays those out itself. */
  warnings: BoardWarning[]
  faults: VescFaultOccurrence[]
  /** Worst severity among warnings the rider has not dismissed; `null` when nothing is pending. */
  severity: BoardWarningSeverity | null
  /** Undismissed warnings — what an indicator is allowed to count. */
  warningCount: number
  faultCount: number
  warningsEnabled: boolean
  faultsEnabled: boolean
}

/**
 * The board's pending trouble, read once for every surface that offers a way into it (the pill
 * badges and the board selector). Faults belong to whichever board the live session writes under —
 * a replay's synthetic board while it plays — so they take their own id.
 */
export function useBoardIssues(
  activeBoardId: string | null,
  sessionBoardId: string | null,
): BoardIssues {
  const warnings = useBoardWarningsStore((s) =>
    activeBoardId ? (s.warningsByBoard[activeBoardId] ?? EMPTY_WARNINGS) : EMPTY_WARNINGS,
  )
  const dismissedKinds = useBoardStore(
    (s) => s.boards.find((b) => b.id === activeBoardId)?.dismissedWarnings,
  )
  const faults = useVescFaultsStore((s) =>
    sessionBoardId ? (s.faultsByBoard[sessionBoardId] ?? EMPTY_FAULTS) : EMPTY_FAULTS,
  )
  const warningsEnabled = useSettingsStore((s) => s.boardWarningsEnabled)
  const faultsEnabled = useSettingsStore((s) => s.vescFaultCollectionEnabled)

  return useMemo(() => {
    const pending = pendingWarnings(warnings, dismissedKinds)
    return {
      warnings,
      faults,
      severity: worstSeverity(pending),
      warningCount: pending.length,
      faultCount: indicatorFaults(faults).length,
      warningsEnabled,
      faultsEnabled,
    }
  }, [warnings, dismissedKinds, faults, warningsEnabled, faultsEnabled])
}
