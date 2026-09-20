import { create } from 'zustand'
import { applyAlertPreset, type AlertPresetIntent } from 'vescape-core'
import { errorMessage } from '@/helpers/error'
import type { AlertPresetLevel, AlertPresetMetric } from '@/modules/alerts/lib/alertPresets'
import { useAlertsStore } from '@/modules/alerts/store/alertsStore'
import { useBoardStore } from '@/modules/board/store/boardStore'

interface AlertPresetState {
  syncing: boolean
}

interface AlertPresetActions {
  setLevel(metric: AlertPresetMetric, level: AlertPresetLevel, boardId?: string): Promise<void>
  customize(metric: AlertPresetMetric, boardId?: string): Promise<void>
  discardCustom(metric: AlertPresetMetric, boardId?: string): Promise<void>
  setMatchBoardConfig(metric: AlertPresetMetric, enabled: boolean, boardId?: string): Promise<void>
}

let pending = 0

/** JS sends intents; native commits the selection and its rules as one operation. */
export const useAlertPresetStore = create<AlertPresetState & AlertPresetActions>((set) => {
  const apply = async (metric: AlertPresetMetric, intent: AlertPresetIntent, boardId?: string) => {
    const targetId = boardId ?? useBoardStore.getState().activeBoardId
    if (!targetId) return
    pending++
    set({ syncing: true })
    useAlertsStore.setState({ error: null })
    try {
      await applyAlertPreset(targetId, metric, intent)
      await Promise.all([
        useBoardStore.getState().load(),
        useAlertsStore.getState().boardId === targetId
          ? useAlertsStore.getState().load(targetId)
          : Promise.resolve(),
      ])
    } catch (error) {
      useAlertsStore.setState({ error: errorMessage(error, 'Unable to save Alert Preset.') })
      throw error
    } finally {
      pending--
      set({ syncing: pending > 0 })
    }
  }
  return {
    syncing: false,
    setLevel: (metric, level, boardId) =>
      apply(
        metric,
        level === 'custom' ? { action: 'customize' } : { action: 'select', level },
        boardId,
      ),
    customize: (metric, boardId) => apply(metric, { action: 'customize' }, boardId),
    discardCustom: (metric, boardId) => apply(metric, { action: 'discard-custom' }, boardId),
    setMatchBoardConfig: (metric, enabled, boardId) =>
      apply(metric, { action: 'match-board-config', enabled }, boardId),
  }
})
