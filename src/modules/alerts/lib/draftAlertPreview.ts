import { previewAlertPreset, type AlertTestRule } from 'vescape-core'
import { errorMessage } from '@/helpers/error'
import type { UnitSystem } from '@/helpers/units'
import type { AlertPresetLevel, AlertPresetMetric } from '@/modules/alerts/lib/alertPresets'
import type { DraftAlertRule } from '@/modules/alerts/lib/customAlertRules'
import { toTestRule } from '@/modules/alerts/lib/alertTest'

/** Ask native for a pure preview, keeping authored draft rules entirely in memory. */
export function draftAlertPreview(
  metric: AlertPresetMetric,
  level: AlertPresetLevel,
  options: { topSpeedKmh: number; hasBatteryConfig: boolean; speedUnitSystem?: UnitSystem },
  customRules: readonly DraftAlertRule[] = [],
): { rules: AlertTestRule[]; presetRules: AlertTestRule[]; error: string | null } {
  const manual = customRules.filter((rule) => rule.enabled).map(toTestRule)
  if (level === 'custom' || level === 'off') return { rules: manual, presetRules: [], error: null }
  try {
    const presetRules = previewAlertPreset(metric, level, options)
    return { rules: [...presetRules, ...manual], presetRules, error: null }
  } catch (error) {
    return {
      rules: manual,
      presetRules: [],
      error: errorMessage(error, 'Unable to preview Alert Preset.'),
    }
  }
}
