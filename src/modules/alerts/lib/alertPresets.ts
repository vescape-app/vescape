import { ALERT_BEEP_COUNT_DEFAULT, type AlertRule } from 'vescape-core'

import {
  resolveConfigRelativeBase,
  type BoardConfigBases,
} from '@/modules/alerts/lib/configRelativeFields'
import { TELEMETRY_THRESHOLDS } from '@/modules/board/constants/telemetryThresholds'

/**
 * Alert Presets — declarative per-metric intensity levels that expand into a set
 * of concrete Alert Rules.
 *
 * This is the pure, tested core the rest of the feature builds on: no UI, no
 * persistence, no native. A rider picks a {@link AlertPresetLevel} per metric and
 * {@link generateAlertPresetRules} deterministically maps `(metric, level, options)`
 * to {@link AlertRuleSpec}s. The store (provenance, ids, regeneration) finalizes
 * those specs — this module never persists.
 *
 * Two feedback families:
 * - **discrete** (battery, motor/controller temperature) → one single-threshold
 *   text-to-speech rule per configured point. Safer levels add more points and
 *   start earlier.
 * - **geiger** (speed, duty) → one range rule (`threshold` → `thresholdMax`) whose
 *   start drops with protection while the ceiling stays fixed.
 *
 * Values seed from the shared {@link TELEMETRY_THRESHOLDS} where sensible so the
 * presets track any future tuning of the visual warning tiers. Tune per-metric
 * counts/values here — never in native or in components.
 */

/**
 * A metric's alert setup: one of the generated intensity levels, `off`, or `custom` —
 * the rider took ownership and hand-edits the rules themselves. `custom` generates
 * nothing, exactly like `off`; the difference is who owns the metric's rules.
 */
export type AlertPresetLevel = 'off' | 'safe' | 'normal' | 'minimal' | 'custom'

export type AlertPresetMetric = 'battery' | 'speed' | 'duty' | 'motor-temp' | 'controller-temp'

/** Ordered generated intensity levels (excludes `off` and `custom`), safest first. */
export const ALERT_PRESET_ACTIVE_LEVELS = ['safe', 'normal', 'minimal'] as const

/** The level a metric lands on when the rider discards their custom rules. */
export const ALERT_PRESET_FALLBACK_LEVEL: AlertPresetLevel = 'normal'

type ActiveLevel = (typeof ALERT_PRESET_ACTIVE_LEVELS)[number]

/**
 * The generative slice of an {@link import('vescape-core').AlertRule} the generator
 * emits. `id`, `createdAt`, `enabled`, and `source` are the store's to finalize.
 */
export interface AlertRuleSpec {
  controlId: AlertPresetMetric
  threshold: number
  thresholdMax: number | null
  thresholdRule?: AlertRule['thresholdRule']
  /**
   * False for a config-relative spec whose field the board cannot currently anchor — the rule is
   * still persisted (the relationship is the durable truth), but {@link threshold} is a placeholder
   * no reader should draw. Native re-resolves every config-relative rule against live config and
   * skips the ones that do not resolve, so an unresolved spec never fires either.
   */
  resolved?: boolean
  soundType: string
  /** Seconds between repeats while the metric stays past the threshold; `null` ⇒ announce once. */
  repeatEverySeconds: number | null
  beepCount: number
}

interface GeigerRange {
  /** Range start; a fraction of Board Top Speed when `scaledByTopSpeed`, else absolute. */
  start: number
  /** Fixed range ceiling; same units as {@link start}. */
  ceiling: number
}

interface DiscreteMetricConfig {
  family: 'discrete'
  /** Text-to-speech template stored directly in `soundType` (JS-only presentation). */
  soundType: string
  /** Only battery today: no rules unless the board has a valid battery config. */
  requiresBatteryConfig?: boolean
  /** Ordered threshold points per level; count grows and starts earlier with protection. */
  levels: Record<ActiveLevel, DiscretePoint[]>
}

/**
 * One generated threshold point. A bare number is a one-shot announcement; the object form adds a
 * repeat cadence for a rung that should keep nagging while the rider stays past it.
 */
type DiscretePoint = number | { threshold: number; repeatEverySeconds: number }

function pointThreshold(point: DiscretePoint): number {
  return typeof point === 'number' ? point : point.threshold
}

function pointRepeatSeconds(point: DiscretePoint): number | null {
  return typeof point === 'number' ? null : point.repeatEverySeconds
}

interface GeigerMetricConfig {
  family: 'geiger'
  /** Geiger tick preset for the range loop. */
  soundType: string
  /** Only speed today: {@link GeigerRange} values are fractions of Board Top Speed. */
  scaledByTopSpeed?: boolean
  levels: Record<ActiveLevel, GeigerRange>
}

type AlertPresetMetricConfig = DiscreteMetricConfig | GeigerMetricConfig

const { battery, temp, duty } = TELEMETRY_THRESHOLDS
const batteryWarningPct = Math.round(battery.warning * 100)
const batteryCriticalPct = Math.round(battery.critical * 100)

/** Geiger tick preset shared by every range-based preset rule. */
export const ALERT_PRESET_GEIGER_SOUND_TYPE = 'preset:tick'

/** Seconds between repeats on a ladder's top rung — slow enough to stay information, not alarm. */
const TEMP_NAG_INTERVAL_SECONDS = 10

/** Motor top rung: 5°C under the stock 100°C throttle point. */
const TEMP_NAG_MOTOR: DiscretePoint = {
  threshold: 95,
  repeatEverySeconds: TEMP_NAG_INTERVAL_SECONDS,
}

/** Controller top rung: the stock 85°C throttle point, i.e. "the board is limiting you now". */
const TEMP_NAG_CONTROLLER: DiscretePoint = {
  threshold: 85,
  repeatEverySeconds: TEMP_NAG_INTERVAL_SECONDS,
}

/**
 * The two temperatures do not share a ladder: VESC stock throttling starts at 100°C for the motor
 * but 85°C for the controller, so the same numbers mean very different things. Each ladder sits
 * under its own throttle point — the rider hears it while easing off still helps — and ends in a
 * repeating rung placed about where the board starts limiting power, the one case where nagging is
 * the correct behavior.
 *
 * Motor temperature is the less trustworthy of the two: plenty of hub motors report nothing usable,
 * and native drops non-positive readings, so this ladder never fires on those Boards.
 */
const MOTOR_TEMP_LEVELS: Record<ActiveLevel, DiscretePoint[]> = {
  safe: [temp.warning, 85, TEMP_NAG_MOTOR],
  normal: [85, TEMP_NAG_MOTOR],
  minimal: [TEMP_NAG_MOTOR],
}

const CONTROLLER_TEMP_LEVELS: Record<ActiveLevel, DiscretePoint[]> = {
  safe: [60, 75, TEMP_NAG_CONTROLLER],
  normal: [75, TEMP_NAG_CONTROLLER],
  minimal: [TEMP_NAG_CONTROLLER],
}

/**
 * Declarative safe/normal/minimal definition for every preset metric. Battery points
 * are in percent (native compares battery single-threshold rules against SoC %
 * directly); temperatures in °C; duty in %; speed as a fraction of Board Top Speed.
 *
 * Key order is the rider-facing order (see {@link ALERT_PRESET_METRICS}): ride metrics
 * first, then the two temperatures, then battery.
 */
export const ALERT_PRESET_LEVELS: Record<AlertPresetMetric, AlertPresetMetricConfig> = {
  speed: {
    family: 'geiger',
    soundType: ALERT_PRESET_GEIGER_SOUND_TYPE,
    scaledByTopSpeed: true,
    levels: {
      safe: { start: 0.6, ceiling: 0.9 },
      normal: { start: 0.72, ceiling: 0.9 },
      minimal: { start: 0.82, ceiling: 0.9 },
    },
  },
  duty: {
    family: 'geiger',
    soundType: ALERT_PRESET_GEIGER_SOUND_TYPE,
    levels: {
      safe: { start: 75, ceiling: duty.critical },
      normal: { start: duty.warning, ceiling: duty.critical },
      minimal: { start: 85, ceiling: duty.critical },
    },
  },
  'motor-temp': {
    family: 'discrete',
    soundType: 'tts:Motor {value} {unit}',
    levels: MOTOR_TEMP_LEVELS,
  },
  'controller-temp': {
    family: 'discrete',
    soundType: 'tts:Controller {value} {unit}',
    levels: CONTROLLER_TEMP_LEVELS,
  },
  battery: {
    family: 'discrete',
    soundType: 'tts:Battery {percent}%',
    requiresBatteryConfig: true,
    levels: {
      safe: [50, 40, batteryWarningPct, 20, 15, batteryCriticalPct, 5],
      normal: [50, 35, 20, batteryCriticalPct, 5],
      minimal: [20, batteryCriticalPct, 5],
    },
  },
}

/**
 * How each metric's preset re-anchors itself when the rider asks it to match the board.
 *
 * The numbers here are *offsets* from the board's own configured point, in the metric's units —
 * that is the whole idea: a preset that says "start warning 10% before the board pushes back"
 * keeps meaning that after the rider retunes the board, where a copied threshold would not.
 * Shapes mirror {@link ALERT_PRESET_LEVELS} exactly, so a matched preset ramps the same way an
 * unmatched one does.
 *
 * Only metrics the board actually has an opinion about appear here; speed (a rider's own top
 * speed) and battery (a pack the controller knows nothing about) have no anchor to follow.
 */
interface DiscreteConfigMatch {
  family: 'discrete'
  fieldId: string
  levels: Record<ActiveLevel, DiscretePoint[]>
}

interface GeigerConfigMatch {
  family: 'geiger'
  fieldId: string
  levels: Record<ActiveLevel, GeigerRange>
}

type AlertPresetConfigMatch = DiscreteConfigMatch | GeigerConfigMatch

/** Temperature ladder offsets: warn while easing off still helps, nag once the board is limiting. */
const TEMP_MATCH_LEVELS: Record<ActiveLevel, DiscretePoint[]> = {
  safe: [-20, -10, { threshold: 0, repeatEverySeconds: TEMP_NAG_INTERVAL_SECONDS }],
  normal: [-10, { threshold: 0, repeatEverySeconds: TEMP_NAG_INTERVAL_SECONDS }],
  minimal: [{ threshold: 0, repeatEverySeconds: TEMP_NAG_INTERVAL_SECONDS }],
}

export const ALERT_PRESET_CONFIG_MATCH: Partial<Record<AlertPresetMetric, AlertPresetConfigMatch>> =
  {
    duty: {
      family: 'geiger',
      fieldId: 'tiltback_duty',
      levels: {
        safe: { start: -15, ceiling: 0 },
        normal: { start: -10, ceiling: 0 },
        minimal: { start: -5, ceiling: 0 },
      },
    },
    'motor-temp': { family: 'discrete', fieldId: 'l_temp_motor_start', levels: TEMP_MATCH_LEVELS },
    'controller-temp': {
      family: 'discrete',
      fieldId: 'l_temp_fet_start',
      levels: TEMP_MATCH_LEVELS,
    },
  }

/** True where the rider can ask this metric's preset to follow the board's own configuration. */
export function supportsBoardConfigMatch(metric: AlertPresetMetric): boolean {
  return ALERT_PRESET_CONFIG_MATCH[metric] != null
}

export interface GenerateAlertPresetRulesOptions {
  /** Board Top Speed in km/h; required to resolve speed thresholds. */
  boardTopSpeedKmh?: number | null
  /** Whether the active board has a valid battery config (battery presets need one). */
  hasBatteryConfig?: boolean
  /** Metrics whose preset should follow the board's own config instead of fixed values. */
  matchBoardConfig?: Partial<Record<AlertPresetMetric, boolean>>
  /** Decoded config values, for preview only; the stored relation remains durable truth. */
  configBases?: BoardConfigBases
}

function isActiveLevel(level: AlertPresetLevel): level is ActiveLevel {
  return (ALERT_PRESET_ACTIVE_LEVELS as readonly string[]).includes(level)
}

/** Round to one decimal place, avoiding trailing binary-float noise. */
function roundTenth(value: number): number {
  return Math.round(value * 10) / 10
}

/**
 * Deterministically expand a preset selection into concrete rule specs.
 *
 * `off`, `custom` — and any guard failure (battery without a valid config, speed without a
 * usable Board Top Speed) — yields `[]` rather than garbage rules. Discrete metrics
 * emit one single-threshold rule per configured point in config order; geiger
 * metrics emit a single range rule.
 */
export function generateAlertPresetRules(
  metric: AlertPresetMetric,
  level: AlertPresetLevel,
  options: GenerateAlertPresetRulesOptions = {},
): AlertRuleSpec[] {
  if (!isActiveLevel(level)) return []

  const config = ALERT_PRESET_LEVELS[metric]

  const match = options.matchBoardConfig?.[metric] ? ALERT_PRESET_CONFIG_MATCH[metric] : undefined
  if (match) return configRelativeSpecs(metric, level, match, options.configBases ?? {})

  if (config.family === 'discrete') {
    if (config.requiresBatteryConfig && !options.hasBatteryConfig) return []
    return config.levels[level].map((point) => ({
      controlId: metric,
      threshold: pointThreshold(point),
      thresholdMax: null,
      soundType: config.soundType,
      repeatEverySeconds: pointRepeatSeconds(point),
      beepCount: ALERT_BEEP_COUNT_DEFAULT,
    }))
  }

  const range = config.levels[level]
  let { start, ceiling } = range
  if (config.scaledByTopSpeed) {
    const topSpeed = options.boardTopSpeedKmh
    if (typeof topSpeed !== 'number' || !Number.isFinite(topSpeed) || topSpeed <= 0) return []
    // Round to 0.1 km/h, not whole km/h: at the low end of Board Top Speed
    // (clamp floor 5) whole-km/h rounding collapses adjacent levels to identical
    // ranges (0.72×5 and 0.82×5 both → 4) and inflates the ceiling past its
    // configured fraction (0.9×5 → 5, i.e. 100%). Native stores thresholds as REAL.
    start = roundTenth(start * topSpeed)
    ceiling = roundTenth(ceiling * topSpeed)
  }

  return [
    {
      controlId: metric,
      threshold: start,
      thresholdMax: ceiling,
      soundType: config.soundType,
      // A range rule's cadence follows range depth, so a repeat interval would mean nothing.
      repeatEverySeconds: null,
      beepCount: ALERT_BEEP_COUNT_DEFAULT,
    },
  ]
}

/**
 * Expand a matched preset into config-relative specs. Every spec carries its offset regardless of
 * whether the board can currently resolve it: an unresolvable anchor (config unread, or that
 * protection switched off on the board) makes the preset dormant, not fixed — see
 * {@link AlertRuleSpec.resolved}.
 */
function configRelativeSpecs(
  metric: AlertPresetMetric,
  level: ActiveLevel,
  match: AlertPresetConfigMatch,
  bases: BoardConfigBases,
): AlertRuleSpec[] {
  const base = resolveConfigRelativeBase(match.fieldId, bases)
  const resolved = base != null
  const at = (offset: number) => (base == null ? 0 : roundTenth(base + offset))
  const soundType = ALERT_PRESET_LEVELS[metric].soundType
  const rule = (thresholdOffset: number, thresholdMaxOffset: number | null) =>
    ({
      kind: 'config-relative',
      fieldId: match.fieldId,
      thresholdOffset,
      thresholdMaxOffset,
    }) as const

  if (match.family === 'geiger') {
    const { start, ceiling } = match.levels[level]
    return [
      {
        controlId: metric,
        threshold: at(start),
        thresholdMax: resolved ? at(ceiling) : null,
        thresholdRule: rule(start, ceiling),
        resolved,
        soundType,
        repeatEverySeconds: null,
        beepCount: ALERT_BEEP_COUNT_DEFAULT,
      },
    ]
  }

  return match.levels[level].map((point) => ({
    controlId: metric,
    threshold: at(pointThreshold(point)),
    thresholdMax: null,
    thresholdRule: rule(pointThreshold(point), null),
    resolved,
    soundType,
    repeatEverySeconds: pointRepeatSeconds(point),
    beepCount: ALERT_BEEP_COUNT_DEFAULT,
  }))
}

/**
 * The specs that describe a threshold a rider could actually see or hear right now. Dormant
 * config-relative specs are dropped: they are persisted as rules, but they have no number to show
 * until the board supplies one.
 */
export function resolvedAlertPresetRules(
  metric: AlertPresetMetric,
  level: AlertPresetLevel,
  options: GenerateAlertPresetRulesOptions = {},
): AlertRuleSpec[] {
  return generateAlertPresetRules(metric, level, options).filter((spec) => spec.resolved !== false)
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
 * Human-readable summary of a metric's active preset thresholds (e.g. `10%, 20%, 30%`
 * for discrete battery, `80–90%` for a geiger range). Built straight from
 * {@link generateAlertPresetRules} so it always mirrors the rules actually applied.
 * Returns `null` when the level is `off` or guarded away (no rules to describe).
 */
export function formatAlertPresetSummary(
  metric: AlertPresetMetric,
  level: AlertPresetLevel,
  options: GenerateAlertPresetRulesOptions = {},
): string | null {
  const specs = resolvedAlertPresetRules(metric, level, options)
  if (specs.length === 0) return null
  const unit = ALERT_PRESET_UNIT[metric]
  return specs
    .map((spec) => {
      if (spec.thresholdMax != null) {
        return `${Math.round(spec.threshold)}–${Math.round(spec.thresholdMax)}${unit}`
      }
      // A repeating rung reads as the point it starts at plus a repeat mark: it has no upper
      // bound, it just keeps going.
      const repeat = spec.repeatEverySeconds == null ? '' : '↻'
      return `${Math.round(spec.threshold)}${unit}${repeat}`
    })
    .join(', ')
}

/** `1, 2 and 3` — a spoken list, since this text is read as a sentence. */
function joinList(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? ''
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

/**
 * What the rider will actually hear at the selected level, in a sentence. Built from
 * {@link generateAlertPresetRules} for the same reason {@link formatAlertPresetSummary} is: the
 * only description worth showing is one that cannot drift from the rules being applied.
 *
 * `null` where there is nothing to describe — a metric guarded away (battery without a config,
 * speed without a Board Top Speed) is explained by the screen, not by this line.
 */
export function describeAlertPreset(
  metric: AlertPresetMetric,
  level: AlertPresetLevel,
  options: GenerateAlertPresetRulesOptions = {},
): string | null {
  if (level === 'off') return 'No sound from this metric.'
  if (level === 'custom') return 'Your own rules — edit them below.'

  const specs = resolvedAlertPresetRules(metric, level, options)
  if (specs.length === 0) return null
  const unit = ALERT_PRESET_UNIT[metric]
  const value = (threshold: number) => `${Math.round(threshold)}${unit}`

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
export const ALERT_PRESET_METRICS = Object.keys(ALERT_PRESET_LEVELS) as AlertPresetMetric[]

/** The rider's chosen level per metric — the durable `alertPreset` settings bag. */
export type AlertPresetSelection = Record<AlertPresetMetric, AlertPresetLevel>

const ALERT_PRESET_LEVEL_VALUES: AlertPresetLevel[] = [
  'off',
  ...ALERT_PRESET_ACTIVE_LEVELS,
  'custom',
]

/** Narrow a control id to the preset metric it names, or `null` when it has no presets. */
export function asAlertPresetMetric(controlId: string | undefined): AlertPresetMetric | null {
  return ALERT_PRESET_METRICS.includes(controlId as AlertPresetMetric)
    ? (controlId as AlertPresetMetric)
    : null
}

/** Every metric `off` — the default before a rider touches any preset. */
export const DEFAULT_ALERT_PRESET_SELECTION: AlertPresetSelection = Object.fromEntries(
  ALERT_PRESET_METRICS.map((metric) => [metric, 'off']),
) as AlertPresetSelection

/**
 * Every metric `normal` — the starting point a new Board's setup opens on. Distinct from
 * {@link DEFAULT_ALERT_PRESET_SELECTION}, which is the fallback for a Board that has no
 * persisted selection at all and must stay `off` so existing Boards never self-arm.
 */
export const NEW_BOARD_ALERT_PRESET_SELECTION: AlertPresetSelection = Object.fromEntries(
  ALERT_PRESET_METRICS.map((metric) => [metric, 'normal']),
) as AlertPresetSelection

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

/**
 * Deterministic rule id for the `index`-th generated rule of a metric. Stable across
 * regeneration so a metric's preset rules always occupy the same id slots.
 */
export function presetAlertRuleId(metric: AlertPresetMetric, index: number): string {
  return `${ALERT_PRESET_SOURCE}:${metric}:${index}`
}

/** True when a rule was generated by an Alert Preset. */
export function isPresetAlertRule(rule: Pick<AlertRule, 'source'>): boolean {
  return rule.source === ALERT_PRESET_SOURCE
}
