import type { AlertRule } from 'vescape-core'

import { isPresetAlertRule } from '@/modules/alerts/lib/alertPresets'

/**
 * Custom (rider-owned) Alert Rules — they fire alongside the metric's Alert Preset.
 *
 * A Board's rules are board-scoped, but the add-board wizard buffers a whole draft Board
 * before one exists, so every rule the UI edits is board-agnostic until it is flushed.
 * {@link DraftAlertRule} is that shape; the live adapter maps its store rules down to it
 * and the wizard holds them in memory until `save()` stamps the new Board's id on.
 */
export type DraftAlertRule = Omit<AlertRule, 'boardId'>

/** A Board's rider-owned rules for one control, newest last. Preset-generated rules are excluded. */
export function customRulesForControl(rules: AlertRule[], controlId: string): DraftAlertRule[] {
  return rules.filter((rule) => rule.controlId === controlId && !isPresetAlertRule(rule))
}
