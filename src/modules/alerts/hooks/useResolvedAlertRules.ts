import { useMemo } from 'react'
import { useAlertsStore } from '@/modules/alerts/store/alertsStore'
import { useBoardStore } from '@/modules/board/store/boardStore'
import { useBoardConfigBases } from '@/modules/alerts/hooks/useBoardConfigBases'
import { resolvedAlertRules } from '@/modules/alerts/lib/resolvedAlertRules'

/** The active Board's saved, enabled rules at their current resolved thresholds. */
export function useResolvedAlertRules() {
  const rules = useAlertsStore((s) => s.rules)
  const rulesBoardId = useAlertsStore((s) => s.boardId)
  const boardId = useBoardStore((s) => s.activeBoardId)
  const bases = useBoardConfigBases()
  return useMemo(
    () => (rulesBoardId === boardId ? resolvedAlertRules(rules, bases) : []),
    [rules, rulesBoardId, boardId, bases],
  )
}
