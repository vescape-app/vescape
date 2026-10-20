import {
  formatSpeedValue,
  speedFromKmh,
  speedToKmh,
  speedUnit,
  type UnitSystem,
} from '@/helpers/units'
import {
  ALERT_BEEP_COUNT_DEFAULT,
  getAlertSounds,
  type AlertSound,
  type AlertSoundCategory,
  type AlertSoundType,
} from 'vescape-core'

import type { DerivedBatteryConfig } from '@/modules/battery/lib/types'
import { telemetryByControlId } from '@/modules/board/constants/telemetry'
import {
  DEFAULT_ALERT_SEEDS,
  type TelemetryAlertTab as AlertTab,
} from '@/modules/board/constants/telemetryThresholds'
import type { DraftAlertRule } from '@/modules/alerts/lib/customAlertRules'
import {
  ALERT_SEVERITY_DEFAULT,
  formatGeigerAlertSound,
  parseAlertSoundString,
  parseGeigerAlertSound,
  parseSlotAlertSound,
  parseTtsAlertSound,
  slotSoundPart,
} from '@/modules/alerts/lib/alertSoundString'

export function getPresetsForCategory(category: AlertSoundCategory): AlertSound[] {
  return getAlertSounds().filter((p) => p.category === category)
}

/** Picker options of `category`: the pack sounds, then My sounds as `alert:my:<id>` / `geiger:my:<id>`. */
export function pickerSounds(
  category: AlertSoundCategory,
  mySounds: { id: string; name: string }[],
): AlertSound[] {
  const kind = category === 'single' ? 'alert' : 'geiger'
  return [
    ...getPresetsForCategory(category),
    ...mySounds.map((sound) => ({ name: sound.name, uri: `${kind}:my:${sound.id}`, category })),
  ]
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
  units: UnitSystem = 'metric',
): string {
  const formatted =
    controlId === 'speed' ? formatSpeedValue(threshold, units) : dialConfig.format(threshold)
  const displayUnit = controlId === 'speed' ? speedUnit(units) : unit
  let result = template
    .replace(/\{value\}/g, formatted)
    .replace(/\{threshold\}/g, formatted)
    .replace(/\{unit\}/g, displayUnit)
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

/** A geiger rule's picker shows its level; a pre-grammar tick name reads as its equivalent level. */
export function geigerPickerSound(soundType: string): string {
  if (parseAlertSoundString(soundType)?.kind === 'geiger') return soundType
  return formatGeigerAlertSound(parseGeigerAlertSound(soundType) ?? 'soft')
}

export function getEditFormDefaults(
  editRule: DraftAlertRule,
  dialConfig: ReturnType<typeof getAlertDialConfig>,
  batteryConfig: DerivedBatteryConfig | null,
) {
  const tts = parseTtsAlertSound(editRule.soundType)
  const tab = (tts ? 'message' : editRule.thresholdMax != null ? 'geiger' : 'single') as AlertTab
  // A single rule's picker shows the pack slot or My sound; its count lives in the beep stepper.
  const slot = tab === 'single' ? parseSlotAlertSound(editRule.soundType) : null
  return {
    tab,
    threshold: editRule.threshold,
    thresholdMax: editRule.thresholdMax ?? dialConfig.max,
    soundType: slot
      ? `alert:${slotSoundPart(editRule.soundType)}`
      : tab === 'geiger'
        ? geigerPickerSound(editRule.soundType)
        : editRule.soundType,
    messageTemplate: tts?.text ?? getDefaultMessageTemplate(editRule.controlId, batteryConfig),
    severity: tts?.severity ?? ALERT_SEVERITY_DEFAULT,
    repeatEverySeconds: editRule.repeatEverySeconds,
    beepCount: slot?.count ?? ALERT_BEEP_COUNT_DEFAULT,
  }
}

export function getNewFormDefaults(
  dialConfig: ReturnType<typeof getAlertDialConfig>,
  defaultSoundType: AlertSoundType,
  geigerSoundType: AlertSoundType,
  controlId: string,
  batteryConfig: DerivedBatteryConfig | null,
  units: UnitSystem = 'metric',
) {
  const snap = (v: number) => {
    if (controlId === 'speed' && units === 'imperial') {
      const mph = Math.min(
        Math.floor(speedFromKmh(dialConfig.max, units)),
        Math.max(
          Math.ceil(speedFromKmh(dialConfig.min, units)),
          Math.round(speedFromKmh(v, units)),
        ),
      )
      return speedToKmh(mph, units)
    }
    return Math.min(
      dialConfig.max,
      Math.max(dialConfig.min, Math.round(v / dialConfig.step) * dialConfig.step),
    )
  }
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
      severity: ALERT_SEVERITY_DEFAULT,
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
    severity: ALERT_SEVERITY_DEFAULT,
  }
}
