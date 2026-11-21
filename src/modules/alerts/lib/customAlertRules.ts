import type { AlertRule } from 'vescape-core'

import { isPresetAlertRule } from '@/modules/alerts/lib/alertPresets'

export type DraftAlertRule = Omit<AlertRule, 'boardId'>

export function customRulesForControl(rules: AlertRule[], controlId: string): DraftAlertRule[] {
  return rules.filter((rule) => rule.controlId === controlId && !isPresetAlertRule(rule))
}
