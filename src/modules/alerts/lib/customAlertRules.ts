import type { AlertRule, AlertTestRule } from 'vescape-core'

import { generateId } from '@/helpers/id'
import { isPresetAlertRule, type AlertPresetLevel } from '@/modules/alerts/lib/alertPresets'

/**
 * Custom (rider-owned) Alert Rules — the `custom` half of {@link AlertPresetLevel}.
 *
 * A Board's rules are board-scoped, but the add-board wizard buffers a whole draft Board
 * before one exists, so every rule the UI edits is board-agnostic until it is flushed.
 * {@link DraftAlertRule} is that shape; the live adapter maps its store rules down to it
 * and the wizard holds them in memory until `save()` stamps the new Board's id on.
 */
export type DraftAlertRule = Omit<AlertRule, 'boardId'>

/** Keep authored rules intact and append editable copies of the native preset preview. */
export function materializePresetRules(
  snapshot: readonly AlertTestRule[],
  authoredRules: readonly DraftAlertRule[],
): DraftAlertRule[] {
  const createdAt = Date.now()
  return [
    ...authoredRules,
    ...snapshot.map((spec) => ({
      id: generateId(),
      controlId: spec.controlId,
      threshold: spec.threshold,
      thresholdMax: spec.thresholdMax,
      enabled: true,
      soundType: spec.soundType,
      repeatEverySeconds: spec.repeatEverySeconds,
      beepCount: spec.beepCount,
      createdAt,
    })),
  ]
}

/** A Board's rider-owned rules for one control, newest last. Preset-generated rules are excluded. */
export function customRulesForControl(rules: AlertRule[], controlId: string): DraftAlertRule[] {
  return rules.filter((rule) => rule.controlId === controlId && !isPresetAlertRule(rule))
}
