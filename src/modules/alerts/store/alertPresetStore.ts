import { create } from 'zustand'
import { applyAlertPreset, type AlertPresetIntent } from 'vescape-core'
import { errorMessage } from '@/helpers/error'
import type { AlertPresetLevel, AlertPresetMetric } from '@/modules/alerts/lib/alertPresets'
import { parseGeigerAlertSound } from '@/modules/alerts/lib/alertSoundString'
import { useAlertsStore } from '@/modules/alerts/store/alertsStore'
import { useBoardStore } from '@/modules/board/store/boardStore'

interface AlertPresetState {
  syncing: boolean
}

interface AlertPresetActions {
  setLevel(metric: AlertPresetMetric, level: AlertPresetLevel): Promise<void>
  setMatchBoardConfig(metric: AlertPresetMetric, enabled: boolean): Promise<void>
  /** Pick the tick level from a `geiger:<level>` sound string. */
  setGeigerSound(metric: AlertPresetMetric, soundType: string): Promise<void>
}

let pending = 0

/** JS sends intents for the active Board; native rewrites the metric's one preset row. */
export const useAlertPresetStore = create<AlertPresetState & AlertPresetActions>((set) => {
  const run = async (write: (boardId: string) => Promise<void>) => {
    const boardId = useBoardStore.getState().activeBoardId
    if (!boardId) return
    pending++
    set({ syncing: true })
    useAlertsStore.setState({ error: null })
    try {
      await write(boardId)
      if (useAlertsStore.getState().boardId === boardId)
        await useAlertsStore.getState().load(boardId)
    } catch (error) {
      useAlertsStore.setState({ error: errorMessage(error, 'Unable to save Alert Preset.') })
      throw error
    } finally {
      pending--
      set({ syncing: pending > 0 })
    }
  }
  const apply = (metric: AlertPresetMetric, intent: AlertPresetIntent) =>
    run((boardId) => applyAlertPreset(boardId, metric, intent))
  return {
    syncing: false,
    setLevel: (metric, level) => apply(metric, { level }),
    setMatchBoardConfig: (metric, enabled) => apply(metric, { match: enabled }),
    setGeigerSound: async (metric, soundType) => {
      const geiger = parseGeigerAlertSound(soundType)
      if (geiger) await apply(metric, { geiger })
    },
  }
})
