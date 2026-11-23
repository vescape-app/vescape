import definitions from '@/../modules/vescape-core/shared/alert-preset-definitions.json'
import {
  formatSpeedValue,
  speedUnit,
  temperatureFromC,
  type DistanceUnit,
  type TemperatureUnit,
} from '@/helpers/units'
import type { AlertRule, AlertTestRule, AlertPresetLevel, AlertPresetMetric } from 'vescape-core'
import {
  GEIGER_LEVELS,
  parseAlertPresetSpec,
  presetSpecOption,
  type GeigerLevel,
} from '@/modules/alerts/lib/alertSoundString'
export type { AlertPresetLevel, AlertPresetMetric } from 'vescape-core'

export const ALERT_PRESET_FALLBACK_LEVEL: AlertPresetLevel = 'normal'

export type AlertRulePresentation = Pick<
  AlertTestRule,
  'threshold' | 'thresholdMax' | 'repeatEverySeconds'
>

export const ALERT_PRESET_CONFIG_FIELDS = Object.fromEntries(
  Object.entries(definitions.match).map(([metric, match]) => [metric, match.fieldId]),
) as Partial<Record<AlertPresetMetric, string>>

export function supportsBoardConfigMatch(metric: AlertPresetMetric): boolean {
  return ALERT_PRESET_CONFIG_FIELDS[metric] != null
}

const ALERT_PRESET_UNIT: Record<AlertPresetMetric, string> = {
  battery: '%',
  duty: '%',
  speed: ' km/h',
  'motor-temp': '°',
  'controller-temp': '°',
}

function isTempPresetMetric(metric: AlertPresetMetric): boolean {
  return metric === 'motor-temp' || metric === 'controller-temp'
}

export function formatAlertPresetSummary(
  metric: AlertPresetMetric,
  specs: AlertRulePresentation[],
  distanceUnit: DistanceUnit = 'km',
  temperatureUnit: TemperatureUnit = 'celsius',
): string | null {
  if (specs.length === 0) return null
  const unit = metric === 'speed' ? ` ${speedUnit(distanceUnit)}` : ALERT_PRESET_UNIT[metric]
  const number = (value: number) =>
    metric === 'speed'
      ? formatSpeedValue(value, distanceUnit, 1)
      : isTempPresetMetric(metric)
        ? Math.round(temperatureFromC(value, temperatureUnit))
        : Math.round(value)
  return specs
    .map((spec) => {
      if (spec.thresholdMax != null) {
        return `${number(spec.threshold)}–${number(spec.thresholdMax)}${unit}`
      }
      const repeat = spec.repeatEverySeconds == null ? '' : '↻'
      return `${number(spec.threshold)}${unit}${repeat}`
    })
    .join(', ')
}

function joinList(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? ''
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

export function describeAlertRules(
  metric: AlertPresetMetric,
  specs: readonly AlertRulePresentation[],
  distanceUnit: DistanceUnit = 'km',
  temperatureUnit: TemperatureUnit = 'celsius',
): string | null {
  if (specs.length === 0) return null
  const unit = metric === 'speed' ? ` ${speedUnit(distanceUnit)}` : ALERT_PRESET_UNIT[metric]
  const number = (value: number) =>
    metric === 'speed'
      ? formatSpeedValue(value, distanceUnit, 1)
      : isTempPresetMetric(metric)
        ? Math.round(temperatureFromC(value, temperatureUnit))
        : Math.round(value)
  const value = (threshold: number) => `${number(threshold)}${unit}`

  const range = specs.find((spec) => spec.thresholdMax != null)
  const ceiling = range?.thresholdMax
  if (range && ceiling != null) {
    return `Ticks like a Geiger counter from ${value(range.threshold)}, faster the deeper you go, solid tone at ${value(ceiling)}.`
  }

  const points = joinList(specs.map((spec) => value(spec.threshold)))
  const repeat = specs.find((spec) => spec.repeatEverySeconds != null)
  if (metric === 'battery') return `Speaks the charge left at ${points}.`
  const nag = repeat
    ? ` The last step repeats every ${repeat.repeatEverySeconds} s while you stay above it.`
    : ''
  return `Speaks the temperature at ${points}.${nag}`
}

export const ALERT_PRESET_METRICS = Object.keys(definitions.metrics) as AlertPresetMetric[]

const STORED_LEVELS: AlertPresetLevel[] = ['off', 'safe', 'normal', 'minimal']

export function asAlertPresetMetric(controlId: string | undefined): AlertPresetMetric | null {
  return ALERT_PRESET_METRICS.includes(controlId as AlertPresetMetric)
    ? (controlId as AlertPresetMetric)
    : null
}

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/AlertSoundString.kt `PRESET_RULE_PREFIX`
 * @parity /modules/vescape-core/ios/alerts/AlertSoundString.swift `presetRulePrefix`
 */
const ALERT_PRESET_RULE_PREFIX = 'preset:'

export function isPresetAlertRule(rule: Pick<AlertRule, 'id'>): boolean {
  return rule.id.startsWith(ALERT_PRESET_RULE_PREFIX)
}

export interface AlertPresetState {
  level: AlertPresetLevel
  geiger: GeigerLevel | null
  match: boolean
}

export function alertPresetState(spec: string | undefined): AlertPresetState {
  const parsed = parseAlertPresetSpec(spec ?? `preset(${ALERT_PRESET_FALLBACK_LEVEL})`)
  const stored = STORED_LEVELS.find((level) => level === parsed?.level) ?? 'off'
  const geiger = parsed && presetSpecOption(parsed, 'geiger')
  return {
    level: stored,
    geiger: GEIGER_LEVELS.find((level) => level === geiger) ?? null,
    match: parsed != null && presetSpecOption(parsed, 'match') === 'on',
  }
}
