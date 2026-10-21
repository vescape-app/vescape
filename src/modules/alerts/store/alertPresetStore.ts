import { create } from 'zustand'
import { applyAlertPreset, type AlertPresetIntent, type AlertTestRule } from 'vescape-core'
import { errorMessage } from '@/helpers/error'
import {
  ALERT_PRESET_FALLBACK_LEVEL,
  isPresetAlertRule,
  type AlertPresetLevel,
  type AlertPresetMetric,
} from '@/modules/alerts/lib/alertPresets'
import { parseGeigerAlertSound } from '@/modules/alerts/lib/alertSoundString'
import { materializePresetRules } from '@/modules/alerts/lib/customAlertRules'
import { useAlertsStore } from '@/modules/alerts/store/alertsStore'
import { useBoardStore } from '@/modules/board/store/boardStore'

interface AlertPresetState {
  syncing: boolean
}

interface AlertPresetActions {
  /** `custom` copies the expanded points, as {@link customize}. */
  setLevel(
    metric: AlertPresetMetric,
    level: AlertPresetLevel,
    presetRules?: readonly AlertTestRule[],
  ): Promise<void>
  /** Copy the metric's expanded preset points into rider rules, then set the preset Off. */
  customize(metric: AlertPresetMetric, presetRules: readonly AlertTestRule[]): Promise<void>
  /** Drop the metric's rider rules and return to the app default level. */
  discardCustom(metric: AlertPresetMetric): Promise<void>
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
  const customize = (metric: AlertPresetMetric, presetRules: readonly AlertTestRule[]) =>
    run(async (boardId) => {
      for (const rule of materializePresetRules(presetRules, []))
        await useAlertsStore.getState().upsert({ ...rule, boardId })
      await applyAlertPreset(boardId, metric, { level: 'off' })
    })
  return {
    syncing: false,
    setLevel: (metric, level, presetRules = []) =>
      level === 'custom' ? customize(metric, presetRules) : apply(metric, { level }),
    customize,
    discardCustom: (metric) =>
      run(async (boardId) => {
        const custom = useAlertsStore
          .getState()
          .rules.filter((rule) => rule.controlId === metric && !isPresetAlertRule(rule))
        for (const rule of custom) await useAlertsStore.getState().remove(rule.id)
        await applyAlertPreset(boardId, metric, { level: ALERT_PRESET_FALLBACK_LEVEL })
      }),
    setMatchBoardConfig: (metric, enabled) => apply(metric, { match: enabled }),
    setGeigerSound: async (metric, soundType) => {
      const geiger = parseGeigerAlertSound(soundType)
      if (geiger) await apply(metric, { geiger })
    },
  }
})
