import definitions from '@/../modules/vescape-core/shared/alert-preset-definitions.json'
import { formatSpeedValue, speedUnit, type UnitSystem } from '@/helpers/units'
import type {
  AlertRule,
  AlertTestRule,
  AlertPresetLevel as StoredPresetLevel,
  AlertPresetMetric,
} from 'vescape-core'
import {
  GEIGER_LEVELS,
  parseAlertPresetSpec,
  presetSpecOption,
  type GeigerLevel,
} from '@/modules/alerts/lib/alertSoundString'
export type { AlertPresetMetric } from 'vescape-core'

/**
 * A metric's level as the setup UI shows it: a stored preset level, or `custom` — the preset Off
 * with the rider's own rules for the metric — until the metric screen drops it (#592).
 */
export type AlertPresetLevel = StoredPresetLevel | 'custom'

/** Native expands presets; JS reads each metric's stored spec and formats the expanded rules. */
export const ALERT_PRESET_FALLBACK_LEVEL: StoredPresetLevel = 'normal'

export type AlertRulePresentation = Pick<
  AlertTestRule,
  'threshold' | 'thresholdMax' | 'repeatEverySeconds'
>

/** Shared config field names for the match-control explanation; no threshold calculation. */
export const ALERT_PRESET_CONFIG_FIELDS = Object.fromEntries(
  Object.entries(definitions.match).map(([metric, match]) => [metric, match.fieldId]),
) as Partial<Record<AlertPresetMetric, string>>

export function supportsBoardConfigMatch(metric: AlertPresetMetric): boolean {
  return ALERT_PRESET_CONFIG_FIELDS[metric] != null
}

/** Per-metric unit suffix appended to a threshold value in a summary (JS-only presentation). */
const ALERT_PRESET_UNIT: Record<AlertPresetMetric, string> = {
  battery: '%',
  duty: '%',
  speed: ' km/h',
  'motor-temp': '°',
  'controller-temp': '°',
}

/**
 * Human-readable summary for an unsaved preset draft (e.g. `10%, 20%, 30%` for battery,
 * `80–90%` for a geiger range), using the native preview snapshot.
 * Returns `null` when the supplied snapshot has no rules to describe.
 */
export function formatAlertPresetSummary(
  metric: AlertPresetMetric,
  specs: AlertRulePresentation[],
  units: UnitSystem = 'metric',
): string | null {
  if (specs.length === 0) return null
  const unit = metric === 'speed' ? ` ${speedUnit(units)}` : ALERT_PRESET_UNIT[metric]
  const number = (value: number) =>
    metric === 'speed' ? formatSpeedValue(value, units, 1) : Math.round(value)
  return specs
    .map((spec) => {
      if (spec.thresholdMax != null) {
        return `${number(spec.threshold)}–${number(spec.thresholdMax)}${unit}`
      }
      // A repeating rung reads as the point it starts at plus a repeat mark: it has no upper
      // bound, it just keeps going.
      const repeat = spec.repeatEverySeconds == null ? '' : '↻'
      return `${number(spec.threshold)}${unit}${repeat}`
    })
    .join(', ')
}

/** `1, 2 and 3` — a spoken list, since this text is read as a sentence. */
function joinList(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? ''
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

/** Describe resolved rules supplied by a saved Board or an unsaved wizard preview. */
export function describeAlertRules(
  metric: AlertPresetMetric,
  specs: readonly AlertRulePresentation[],
  units: UnitSystem = 'metric',
): string | null {
  if (specs.length === 0) return null
  const unit = metric === 'speed' ? ` ${speedUnit(units)}` : ALERT_PRESET_UNIT[metric]
  const number = (value: number) =>
    metric === 'speed' ? formatSpeedValue(value, units, 1) : Math.round(value)
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

/** Every metric that carries a preset, in the stable rider-facing order. */
export const ALERT_PRESET_METRICS = Object.keys(definitions.metrics) as AlertPresetMetric[]

const STORED_LEVELS: StoredPresetLevel[] = ['off', 'safe', 'normal', 'minimal']

/** Narrow a control id to the preset metric it names, or `null` when it has no presets. */
export function asAlertPresetMetric(controlId: string | undefined): AlertPresetMetric | null {
  return ALERT_PRESET_METRICS.includes(controlId as AlertPresetMetric)
    ? (controlId as AlertPresetMetric)
    : null
}

/**
 * Id prefix of a preset row and of the rules native expands it to (`preset:<metric>:<index>`).
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/AlertSoundString.kt `PRESET_RULE_PREFIX`
 * @parity /modules/vescape-core/ios/alerts/AlertSoundString.swift `presetRulePrefix`
 */
const ALERT_PRESET_RULE_PREFIX = 'preset:'

/** True when native expanded a rule from an Alert Preset rather than the rider authoring it. */
export function isPresetAlertRule(rule: Pick<AlertRule, 'id'>): boolean {
  return rule.id.startsWith(ALERT_PRESET_RULE_PREFIX)
}

/** One metric's preset as the setup UI reads it from the stored spec. */
export interface AlertPresetState {
  level: AlertPresetLevel
  /** The rider's tick level; `null` plays the definition's default. */
  geiger: GeigerLevel | null
  /** Config-relative points follow the board config. */
  match: boolean
}

/**
 * Read a stored spec (`preset(normal)` when the Board has none). A level this app does not know
 * reads as Off, the way native expands it. Off with rider rules reads as `custom`.
 */
export function alertPresetState(
  spec: string | undefined,
  hasRiderRules: boolean,
): AlertPresetState {
  const parsed = parseAlertPresetSpec(spec ?? `preset(${ALERT_PRESET_FALLBACK_LEVEL})`)
  const stored = STORED_LEVELS.find((level) => level === parsed?.level) ?? 'off'
  const geiger = parsed && presetSpecOption(parsed, 'geiger')
  return {
    level: stored === 'off' && hasRiderRules ? 'custom' : stored,
    geiger: GEIGER_LEVELS.find((level) => level === geiger) ?? null,
    match: parsed != null && presetSpecOption(parsed, 'match') === 'on',
  }
}
