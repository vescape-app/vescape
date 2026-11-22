import { create } from 'zustand'
import {
  deleteAlertRule,
  getAlertPresets,
  getAlertRules,
  type AlertPresetMetric,
  setAlertRuleEnabled,
  type AlertRule,
  type AlertSpec,
  upsertAlertRule,
} from 'vescape-core'
import { generateId } from '@/helpers/id'
import { errorMessage } from '@/helpers/error'

export type { AlertSpec } from 'vescape-core'

interface AlertsState {
  boardId: string | null
  rules: AlertRule[]
  presets: Partial<Record<AlertPresetMetric, string>>
  error: string | null
}

export interface AlertRuleDraft {
  threshold: number
  thresholdMax: number | null
  spec: AlertSpec
  repeatEverySeconds: number | null
}

interface AlertsActions {
  load(boardId: string | null): Promise<void>
  add(controlId: string, draft: AlertRuleDraft): Promise<void>
  update(id: string, draft: AlertRuleDraft): Promise<void>
  upsert(rule: AlertRule): Promise<void>
  setEnabled(id: string, enabled: boolean): Promise<void>
  toggle(id: string): Promise<void>
  remove(id: string): Promise<void>
}

let loadGeneration = 0

export const useAlertsStore = create<AlertsState & AlertsActions>((set, get) => ({
  boardId: null,
  rules: [],
  presets: {},
  error: null,

  async load(boardId) {
    const request = ++loadGeneration
    const previous = get()
    const same = previous.boardId === boardId
    set({
      boardId,
      rules: same ? previous.rules : [],
      presets: same ? previous.presets : {},
      error: null,
    })
    if (!boardId) return
    try {
      const [rules, presets] = await Promise.all([getAlertRules(boardId), getAlertPresets(boardId)])
      if (request === loadGeneration && get().boardId === boardId)
        set({ rules, presets, error: null })
    } catch (error) {
      if (request === loadGeneration && get().boardId === boardId) {
        set({ error: errorMessage(error, 'Unable to load Alert Rules.') })
      }
      throw error
    }
  },

  async add(controlId, draft) {
    set({ error: null })
    const boardId = get().boardId
    if (!boardId) return
    const rule: AlertRule = {
      boardId,
      id: generateId(),
      controlId,
      enabled: true,
      createdAt: Date.now(),
      ...draft,
    }
    try {
      await upsertAlertRule(rule)
    } catch (error) {
      set({ error: errorMessage(error, 'Unable to save Alert Rule.') })
      throw error
    }
    if (get().boardId === boardId) set((s) => ({ rules: [...s.rules, rule] }))
  },

  async update(id, draft) {
    set({ error: null })
    const rule = get().rules.find((r) => r.id === id)
    if (!rule) return
    const updated = { ...rule, ...draft }
    try {
      await upsertAlertRule(updated)
    } catch (error) {
      set({ error: errorMessage(error, 'Unable to save Alert Rule.') })
      throw error
    }
    if (get().boardId === rule.boardId) {
      set((s) => ({ rules: s.rules.map((r) => (r.id === id ? updated : r)) }))
    }
  },

  async upsert(rule) {
    set({ error: null })
    try {
      await upsertAlertRule(rule)
    } catch (error) {
      set({ error: errorMessage(error, 'Unable to save Alert Rule.') })
      throw error
    }
    if (rule.boardId === get().boardId) {
      set((s) => {
        const exists = s.rules.some((r) => r.id === rule.id)
        return {
          rules: exists ? s.rules.map((r) => (r.id === rule.id ? rule : r)) : [...s.rules, rule],
        }
      })
    }
  },

  async setEnabled(id, enabled) {
    set({ error: null })
    const boardId = get().boardId
    if (!boardId) return
    try {
      await setAlertRuleEnabled(boardId, id, enabled)
    } catch (error) {
      set({ error: errorMessage(error, 'Unable to save Alert Rule.') })
      throw error
    }
    if (get().boardId === boardId) {
      set((s) => ({ rules: s.rules.map((r) => (r.id === id ? { ...r, enabled } : r)) }))
    }
  },

  async toggle(id) {
    const rule = get().rules.find((r) => r.id === id)
    if (!rule) return
    await get().setEnabled(id, !rule.enabled)
  },

  async remove(id) {
    set({ error: null })
    const boardId = get().boardId
    if (!boardId) return
    try {
      await deleteAlertRule(boardId, id)
    } catch (error) {
      set({ error: errorMessage(error, 'Unable to delete Alert Rule.') })
      throw error
    }
    if (get().boardId === boardId) set((s) => ({ rules: s.rules.filter((r) => r.id !== id) }))
  },
}))
