import definitions from '@/../modules/vescape-core/shared/alert-preset-definitions.json'
import { formatSpeedValue, speedUnit, type UnitSystem } from '@/helpers/units'
import type { AlertRule, AlertTestRule, AlertPresetLevel, AlertPresetMetric } from 'vescape-core'
export type { AlertPresetLevel, AlertPresetMetric } from 'vescape-core'

/** Native owns preset generation; JS holds selection state and formats returned rules. */
export const ALERT_PRESET_FALLBACK_LEVEL: AlertPresetLevel = 'normal'

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

// --- Provenance + persistence (the store's contract) ---
//
// @parity /modules/vescape-core/src/index.ts `AlertRule.source`

/** Free-text `AlertRule.source` tag marking a rule as generated + owned by preset regeneration. */
export const ALERT_PRESET_SOURCE = 'preset'

/** Every metric that carries a preset selection, in the stable rider-facing order. */
export const ALERT_PRESET_METRICS = Object.keys(definitions.metrics) as AlertPresetMetric[]

/** The rider's chosen level per metric — the durable `alertPreset` settings bag. */
export type AlertPresetSelection = Record<AlertPresetMetric, AlertPresetLevel>

const ALERT_PRESET_LEVEL_VALUES: AlertPresetLevel[] = ['off', 'safe', 'normal', 'minimal', 'custom']

/** Narrow a control id to the preset metric it names, or `null` when it has no presets. */
export function asAlertPresetMetric(controlId: string | undefined): AlertPresetMetric | null {
  return ALERT_PRESET_METRICS.includes(controlId as AlertPresetMetric)
    ? (controlId as AlertPresetMetric)
    : null
}

/** Every metric `off` — the default before a rider touches any preset. */
export const DEFAULT_ALERT_PRESET_SELECTION: AlertPresetSelection = Object.fromEntries(
  ALERT_PRESET_METRICS.map((metric) => [metric, 'off']),
) as Record<AlertPresetMetric, AlertPresetLevel>

/**
 * Every metric `normal` — the starting point a new Board's setup opens on. Distinct from
 * {@link DEFAULT_ALERT_PRESET_SELECTION}, which is the fallback for a Board that has no
 * persisted selection at all and must stay `off` so existing Boards never self-arm.
 */
export const NEW_BOARD_ALERT_PRESET_SELECTION: AlertPresetSelection = Object.fromEntries(
  ALERT_PRESET_METRICS.map((metric) => [metric, 'normal']),
) as Record<AlertPresetMetric, AlertPresetLevel>

/** Coerce a persisted bag back into a full, valid selection; unknown/garbage levels fall to `off`. */
export function normalizeAlertPresetSelection(raw: unknown): AlertPresetSelection {
  const value = (raw && typeof raw === 'object' ? raw : {}) as Partial<
    Record<AlertPresetMetric, unknown>
  >
  return Object.fromEntries(
    ALERT_PRESET_METRICS.map((metric) => {
      const level = value[metric]
      return [metric, ALERT_PRESET_LEVEL_VALUES.includes(level as AlertPresetLevel) ? level : 'off']
    }),
  ) as AlertPresetSelection
}

/** True when a rule was generated by an Alert Preset. */
export function isPresetAlertRule(rule: Pick<AlertRule, 'source'>): boolean {
  return rule.source === ALERT_PRESET_SOURCE
}
