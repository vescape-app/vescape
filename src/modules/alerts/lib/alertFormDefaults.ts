import {
  ALERT_BEEP_COUNT_DEFAULT,
  getAlertSounds,
  type AlertSound,
  type AlertSoundCategory,
  type AlertSoundType,
} from 'vescape-core'

import { type DerivedBatteryConfig } from '@/modules/battery/lib/types'
import { telemetryByControlId } from '@/modules/board/constants/telemetry'
import {
  DEFAULT_ALERT_SEEDS,
  type TelemetryAlertTab as AlertTab,
} from '@/modules/board/constants/telemetryThresholds'
import { type DraftAlertRule } from '@/modules/alerts/lib/customAlertRules'

export function getPresetsForCategory(category: AlertSoundCategory): AlertSound[] {
  return getAlertSounds().filter((p) => p.category === category)
}

export function getDefaultMessageTemplate(
  controlId: string,
  batteryConfig: DerivedBatteryConfig | null,
): string {
  if (controlId === 'battery') {
    return batteryConfig ? 'Battery {percent}%' : 'Battery {voltage}V'
  }
  const metric = telemetryByControlId[controlId]
  // Drop the "Temp" suffix — the °C unit already makes temperature obvious when spoken.
  if (metric) return `${metric.label.replace(/ Temp$/, '')} {value} {unit}`
  return '{value} {unit}'
}

export function getMessagePlaceholders(
  controlId: string,
  batteryConfig: DerivedBatteryConfig | null,
): string[] {
  const base = ['{value}', '{threshold}', '{unit}']
  if (controlId === 'battery') {
    return [...base, batteryConfig ? '{percent}' : '{voltage}']
  }
  return base
}

export function renderPreviewTemplate(
  template: string,
  threshold: number,
  unit: string,
  dialConfig: ReturnType<typeof getAlertDialConfig>,
  controlId: string,
  batteryConfig: DerivedBatteryConfig | null,
): string {
  const formatted = dialConfig.format(threshold)
  let result = template
    .replace(/\{value\}/g, formatted)
    .replace(/\{threshold\}/g, formatted)
    .replace(/\{unit\}/g, unit)
  if (controlId === 'battery') {
    if (batteryConfig) {
      result = result.replace(/\{percent\}/g, formatted)
    } else {
      result = result.replace(/\{voltage\}/g, formatted)
    }
  }
  return result
}

export function getAlertDialConfig(controlId: string, batteryConfig: DerivedBatteryConfig | null) {
  if (controlId === 'battery' && batteryConfig) {
    return {
      min: 0,
      max: 100,
      step: 1,
      format: (v: number) => `${Math.round(v)}`,
      unit: '%',
    }
  }
  const metric = telemetryByControlId[controlId]
  if (!metric) return { min: 0, max: 100, step: 1, format: (v: number) => String(v), unit: '' }
  const step =
    metric.decimals === 0 ? 1 : Number(Math.pow(10, -metric.decimals).toFixed(metric.decimals))
  return {
    min: metric.chartRange.min,
    max: metric.chartRange.max,
    step,
    format: metric.format,
    unit: metric.unit,
  }
}

export function getEditFormDefaults(
  editRule: DraftAlertRule,
  dialConfig: ReturnType<typeof getAlertDialConfig>,
  batteryConfig: DerivedBatteryConfig | null,
) {
  const isTts = editRule.soundType.startsWith('tts:')
  return {
    tab: (isTts ? 'message' : editRule.thresholdMax != null ? 'geiger' : 'single') as AlertTab,
    threshold: editRule.threshold,
    thresholdMax: editRule.thresholdMax ?? dialConfig.max,
    soundType: editRule.soundType,
    messageTemplate: isTts
      ? editRule.soundType.slice(4)
      : getDefaultMessageTemplate(editRule.controlId, batteryConfig),
    repeatEverySeconds: editRule.repeatEverySeconds,
    beepCount: editRule.beepCount,
  }
}

export function getNewFormDefaults(
  dialConfig: ReturnType<typeof getAlertDialConfig>,
  defaultSoundType: AlertSoundType,
  geigerSoundType: AlertSoundType,
  controlId: string,
  batteryConfig: DerivedBatteryConfig | null,
) {
  const snap = (v: number) =>
    Math.min(
      dialConfig.max,
      Math.max(dialConfig.min, Math.round(v / dialConfig.step) * dialConfig.step),
    )
  const high = snap(dialConfig.min + (dialConfig.max - dialConfig.min) * 0.75)

  const preset = DEFAULT_ALERT_SEEDS[controlId]
  if (preset) {
    return {
      tab: preset.tab,
      threshold: snap(preset.threshold),
      thresholdMax: preset.thresholdMax != null ? snap(preset.thresholdMax) : high,
      soundType: preset.tab === 'geiger' ? geigerSoundType : defaultSoundType,
      messageTemplate: getDefaultMessageTemplate(controlId, batteryConfig),
      repeatEverySeconds: null,
      beepCount: ALERT_BEEP_COUNT_DEFAULT,
    }
  }

  return {
    tab: 'single' as AlertTab,
    threshold: snap((dialConfig.min + dialConfig.max) / 2),
    thresholdMax: high,
    soundType: defaultSoundType,
    messageTemplate: getDefaultMessageTemplate(controlId, batteryConfig),
    repeatEverySeconds: null,
    beepCount: ALERT_BEEP_COUNT_DEFAULT,
  }
}
