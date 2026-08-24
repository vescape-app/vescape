import {
  ALERT_PRESET_CONFIG_MATCH,
  type AlertPresetMetric,
} from '@/modules/alerts/lib/alertPresets'
import { boardMatchBoardConfig } from '@/modules/alerts/lib/boardAlertSettings'
import { readBoardConfigBases } from '@/modules/alerts/lib/boardConfigBases'
import { resolveConfigRelativeBase } from '@/modules/alerts/lib/configRelativeFields'
import { useAlertPresetStore } from '@/modules/alerts/store/alertPresetStore'
import { useBoardConfigValuesStore } from '@/modules/board/store/boardConfigValuesStore'
import { useBoardStore } from '@/modules/board/store/boardStore'
import { useMotorConfigValuesStore } from '@/modules/board/store/motorConfigValuesStore'

/**
 * Keep matched Alert Presets in step with the board's own configuration.
 *
 * A matched rule stores its offset, and native re-resolves it — but the rule's persisted
 * `threshold` is what every consumer without a config in hand draws (the HUD gauge, chart
 * reference lines), and a rule whose anchor did not resolve is not written at all. So when a board
 * finally reports the field a preset follows — or reports a new value for it after a retune — the
 * metric's rules are regenerated against it.
 *
 * Only a change in the resolved anchor triggers work: config reads land on every connect, and
 * rewriting identical rules on each one would churn the alert tables for nothing.
 *
 * Call once at app root; returns an unsubscribe.
 */
export function startAlertPresetConfigSync(): () => void {
  let lastBases = new Map<AlertPresetMetric, number | null>()
  let lastBoardId: string | null = null

  const check = () => {
    const board = useBoardStore
      .getState()
      .boards.find((b) => b.id === useBoardStore.getState().activeBoardId)
    if (board?.id !== lastBoardId) {
      lastBoardId = board?.id ?? null
      lastBases = new Map()
    }
    if (!board) return

    const matched = boardMatchBoardConfig(board)
    const bases = readBoardConfigBases()
    for (const metric of Object.keys(matched) as AlertPresetMetric[]) {
      const fieldId = ALERT_PRESET_CONFIG_MATCH[metric]?.fieldId
      if (fieldId == null) continue
      const base = resolveConfigRelativeBase(fieldId, bases)
      if (lastBases.has(metric) && lastBases.get(metric) === base) continue
      lastBases.set(metric, base)
      void useAlertPresetStore.getState().regenerate(metric, board.id)
    }
  }

  const unsubscribers = [
    useBoardConfigValuesStore.subscribe(check),
    useMotorConfigValuesStore.subscribe(check),
    useBoardStore.subscribe(check),
  ]
  check()
  return () => unsubscribers.forEach((unsubscribe) => unsubscribe())
}
