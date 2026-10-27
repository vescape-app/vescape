import { previewAlertPreset, type AlertTestRule } from 'vescape-core'
import { errorMessage } from '@/helpers/error'
import type { DistanceUnit } from '@/helpers/units'
import type { AlertPresetLevel, AlertPresetMetric } from '@/modules/alerts/lib/alertPresets'
import type { DraftAlertRule } from '@/modules/alerts/lib/customAlertRules'
import { toTestRule } from '@/modules/alerts/lib/alertTest'
import { formatAlertPresetSpec } from '@/modules/alerts/lib/alertSoundString'

/** Ask native to expand the draft level's spec, keeping authored draft rules entirely in memory. */
export function draftAlertPreview(
  metric: AlertPresetMetric,
  level: AlertPresetLevel,
  options: { topSpeedKmh: number; hasBatteryConfig: boolean; distanceUnit?: DistanceUnit },
  customRules: readonly DraftAlertRule[] = [],
): { rules: AlertTestRule[]; presetRules: AlertTestRule[]; error: string | null } {
  const manual = customRules.filter((rule) => rule.enabled).map(toTestRule)
  if (level === 'off') return { rules: manual, presetRules: [], error: null }
  try {
    const presetRules = previewAlertPreset(
      metric,
      formatAlertPresetSpec({ level, options: [] }),
      options,
    )
    return { rules: [...presetRules, ...manual], presetRules, error: null }
  } catch (error) {
    return {
      rules: manual,
      presetRules: [],
      error: errorMessage(error, 'Unable to preview Alert Preset.'),
    }
  }
}
