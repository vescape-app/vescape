import { useMemo } from 'react'
import type { BoardWarning, BoardWarningSeverity, VescFaultOccurrence } from 'vescape-core'

import { pendingWarnings, worstSeverity } from '@/modules/board/lib/boardWarnings'
import { indicatorFaults } from '@/modules/board/lib/vescFaults'
import { EMPTY_WARNINGS, useBoardWarningsStore } from '@/modules/board/store/boardWarningsStore'
import { EMPTY_FAULTS, useVescFaultsStore } from '@/modules/board/store/vescFaultsStore'
import { useBoardStore } from '@/modules/board/store/boardStore'
import { useSettingsStore } from '@/modules/settings/store/settingsStore'

export interface BoardIssues {
  warnings: BoardWarning[]
  faults: VescFaultOccurrence[]
  severity: BoardWarningSeverity | null
  warningCount: number
  faultCount: number
  warningsEnabled: boolean
  faultsEnabled: boolean
}

export function useBoardIssues(activeBoardId: string | null): BoardIssues {
  const warnings = useBoardWarningsStore((s) =>
    activeBoardId ? (s.warningsByBoard[activeBoardId] ?? EMPTY_WARNINGS) : EMPTY_WARNINGS,
  )
  const dismissedKinds = useBoardStore(
    (s) => s.boards.find((b) => b.id === activeBoardId)?.dismissedWarnings,
  )
  const faults = useVescFaultsStore((s) =>
    activeBoardId ? (s.faultsByBoard[activeBoardId] ?? EMPTY_FAULTS) : EMPTY_FAULTS,
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
