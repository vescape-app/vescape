import type { BoardWarning, BoardWarningKind, BoardWarningSeverity } from 'vescape-core'
import { DASH } from '@/helpers/format'

/**
 * Rider-facing titles per Board Warning kind. Keyed by the exhaustive `BoardWarningKind` union, so adding a
 * native kind without a title here is a compile error rather than a warning that renders as a raw slug.
 */
const WARNING_TITLES: Record<BoardWarningKind, string> = {
  'cell-spread': 'Cell voltage spread',
  'battery-config-mismatch': 'Battery config mismatch',
  'footpad-disabled': 'Footpad sensor disabled',
  'lv-pushback-low': 'Low-voltage pushback too low',
  'hv-pushback-high': 'High-voltage pushback too high',
  'duty-pushback-high': 'Duty pushback too high',
  'moving-fault-disabled': 'Moving-fault protection off',
}

/**
 * Rider-facing one-liners explaining what each warning means and why it matters, since payload params
 * like `tiltback_hv` mean nothing to most riders.
 */
const WARNING_DESCRIPTIONS: Record<BoardWarningKind, string> = {
  'cell-spread':
    'Battery cell groups differ in voltage more than expected — a sign of a weak or unbalanced pack.',
  'battery-config-mismatch':
    'The BMS reports a different cell count than the battery series count configured on the board.',
  'footpad-disabled':
    'Both footpad sensor zones are disabled — the board cannot detect when you step off.',
  'lv-pushback-low':
    'Low-voltage pushback starts below the safe minimum, so the board may warn too late before the battery cuts out.',
  'hv-pushback-high':
    'High-voltage pushback starts above the safe maximum, so braking on a full charge can overcharge the battery without warning.',
  'duty-pushback-high':
    'Duty pushback starts above the safe maximum, leaving too little motor headroom before a nosedive.',
  'moving-fault-disabled':
    'Fault detection while moving is turned off, weakening protection against sensor faults during a ride.',
}

/**
 * Human title for a warning kind, falling back to the raw kind for unknown detectors (a newer native build
 * may emit a kind this app version does not know).
 */
export function warningTitle(kind: string): string {
  return WARNING_TITLES[kind as BoardWarningKind] ?? kind
}

/** Rider-facing explanation for a warning kind, or null for unknown kinds. */
export function warningDescription(kind: string): string | null {
  return WARNING_DESCRIPTIONS[kind as BoardWarningKind] ?? null
}

/** Worst active severity across a board's warnings, or null when there are none. */
export function worstSeverity(warnings: BoardWarning[]): BoardWarningSeverity | null {
  if (warnings.length === 0) return null
  return warnings.some((w) => w.severity === 'critical') ? 'critical' : 'warn'
}

export interface WarningDetailEntry {
  label: string
  value: string
}

/**
 * Bespoke value/bound rendering for the config-scoped kinds sharing the `{ param, value, bound }`
 * payload shape (see docs/board-warnings.md). Maps the raw numbers to unit-labelled "current vs safe
 * limit" rows. Boolean rules (footpad, moving-fault) render no numeric rows — the description says it all.
 */
const CONFIG_DETAIL: Partial<
  Record<BoardWarningKind, { boundLabel: string; format: (n: number) => string }>
> = {
  'lv-pushback-low': { boundLabel: 'Safe minimum', format: fmtVolts },
  'hv-pushback-high': { boundLabel: 'Safe maximum', format: fmtVolts },
  'duty-pushback-high': { boundLabel: 'Safe maximum', format: fmtDutyPercent },
  'footpad-disabled': { boundLabel: '', format: () => '' },
  'moving-fault-disabled': { boundLabel: '', format: () => '' },
}

/**
 * Decode a warning's kind-specific JSON payload into label/value detail rows. Config-scoped kinds get
 * unit-aware "Current value / Safe limit" rows; other kinds fall back to generic key/value rendering of
 * whatever payload keys are present.
 */
export function parseWarningDetail(kind: string, payloadJson: string): WarningDetailEntry[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(payloadJson)
  } catch {
    return []
  }
  if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) return []
  const obj = parsed as Record<string, unknown>

  const config = CONFIG_DETAIL[kind as BoardWarningKind]
  if (config) {
    if (config.boundLabel === '') return []
    const value = obj.value
    const bound = obj.bound
    if (typeof value !== 'number' || typeof bound !== 'number') return []
    return [
      { label: 'Current value', value: config.format(value) },
      { label: config.boundLabel, value: config.format(bound) },
    ]
  }

  return Object.entries(obj).map(([key, value]) => ({
    label: humanizeKey(key),
    value: formatValue(value),
  }))
}

function fmtVolts(n: number): string {
  return `${n % 1 === 0 ? n.toFixed(0) : n.toFixed(1)} V`
}

/** Duty payload values are 0–1 fractions; riders think in percent. */
function fmtDutyPercent(n: number): string {
  return `${Math.round(n * 100)}%`
}

function humanizeKey(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

function formatValue(value: unknown): string {
  if (value == null) return DASH
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(3)
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  return String(value)
}
