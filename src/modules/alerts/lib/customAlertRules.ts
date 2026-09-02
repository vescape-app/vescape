import type { AlertRule } from 'vescape-core'

import { generateId } from '@/helpers/id'
import {
  isPresetAlertRule,
  resolvedAlertPresetRules,
  type AlertPresetLevel,
  type AlertPresetMetric,
  type GenerateAlertPresetRulesOptions,
} from '@/modules/alerts/lib/alertPresets'

/**
 * Custom (rider-owned) Alert Rules — the `custom` half of {@link AlertPresetLevel}.
 *
 * A Board's rules are board-scoped, but the add-board wizard buffers a whole draft Board
 * before one exists, so every rule the UI edits is board-agnostic until it is flushed.
 * {@link DraftAlertRule} is that shape; the live adapter maps its store rules down to it
 * and the wizard holds them in memory until `save()` stamps the new Board's id on.
 */
export type DraftAlertRule = Omit<AlertRule, 'boardId' | 'updatedAt'>

/**
 * Take ownership of a level: expand it exactly as the preset generator would, then hand the
 * result to the rider as ordinary rules.
 *
 * Behaviourally a no-op at the moment it runs — same thresholds, same sounds — so switching a
 * metric to `custom` never changes what the board says out loud. Ids are fresh and `source` is
 * absent by construction: reusing the deterministic `preset:<metric>:<i>` ids would let the next
 * regeneration overwrite or delete rules the rider now owns.
 *
 * A matched preset is frozen at what it resolves to right now — that is what taking ownership
 * means: the rule stops following the board.
 */
export function materializePresetRules(
  metric: AlertPresetMetric,
  level: AlertPresetLevel,
  options: GenerateAlertPresetRulesOptions = {},
): DraftAlertRule[] {
  const createdAt = Date.now()
  // Resolved only: a dormant matched rule has no threshold to hand over, and freezing its
  // placeholder would give the rider a fixed rule at a value the board never acts on.
  return resolvedAlertPresetRules(metric, level, options).map((spec) => ({
    id: generateId(),
    controlId: spec.controlId,
    threshold: spec.threshold,
    thresholdMax: spec.thresholdMax,
    enabled: true,
    soundType: spec.soundType,
    repeatEverySeconds: spec.repeatEverySeconds,
    beepCount: spec.beepCount,
    createdAt,
  }))
}

/** A Board's rider-owned rules for one control, newest last. Preset-generated rules are excluded. */
export function customRulesForControl(rules: AlertRule[], controlId: string): DraftAlertRule[] {
  return rules.filter((rule) => rule.controlId === controlId && !isPresetAlertRule(rule))
}
