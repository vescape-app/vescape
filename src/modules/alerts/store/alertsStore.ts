import { create } from 'zustand'
import {
  deleteAlertRule,
  getAlertRules,
  setAlertRuleEnabled,
  type AlertRule,
  type AlertSoundType,
  upsertAlertRule,
} from 'vescape-core'
import { generateId } from '@/helpers/id'
import { errorMessage } from '@/helpers/error'

export type { AlertSoundType } from 'vescape-core'

interface AlertsState {
  /**
   * The Board whose rules are currently loaded. Alert Rules are owned by one Board (#254) and the
   * native alert engine evaluates only the connected Board's rules — so the store mirrors exactly
   * the active Board's rules, and reloads whenever the active Board changes. `null` ⇒ no Board.
   */
  boardId: string | null
  rules: AlertRule[]
  error: string | null
}

/**
 * Everything the rider can author on a rule. Grouped rather than passed positionally: a rule now
 * carries a shape (threshold / range), a sound, a repeat cadence and a beep count, and every one of
 * those travels together from the form to the store to native.
 */
export interface AlertRuleDraft {
  threshold: number
  thresholdMax: number | null
  soundType: AlertSoundType
  /** Seconds between repeats while past the threshold; `null` ⇒ announce once per crossing. */
  repeatEverySeconds: number | null
  beepCount: number
}

interface AlertsActions {
  /** Bind the store to a Board and load its rules. `null` clears to an empty rule set. */
  load(boardId: string | null): Promise<void>
  add(controlId: string, draft: AlertRuleDraft): Promise<void>
  update(id: string, draft: AlertRuleDraft): Promise<void>
  upsert(rule: AlertRule): Promise<void>
  setEnabled(id: string, enabled: boolean): Promise<void>
  toggle(id: string): Promise<void>
  remove(id: string): Promise<void>
}

// Monotonic token so an older in-flight load() can never overwrite a newer one's result (even for
// the same Board — e.g. a reload racing a regeneration).
let loadGeneration = 0

export const useAlertsStore = create<AlertsState & AlertsActions>((set, get) => ({
  boardId: null,
  rules: [],
  error: null,

  async load(boardId) {
    const request = ++loadGeneration
    const previous = get()
    // Clear immediately on bind so the UI never shows the previous Board's rules as the new Board's
    // (their deterministic preset ids overlap, so a stray toggle/delete would target the wrong rows).
    set({ boardId, rules: previous.boardId === boardId ? previous.rules : [], error: null })
    if (!boardId) return
    try {
      const rules = await getAlertRules(boardId)
      if (request === loadGeneration && get().boardId === boardId) set({ rules, error: null })
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
    // Only reflect the durable rule locally when it belongs to the bound Board.
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
