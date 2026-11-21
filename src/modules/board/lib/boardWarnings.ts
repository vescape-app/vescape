import type { BoardWarning, BoardWarningKind, BoardWarningSeverity } from 'vescape-core'
import { DASH } from '@/helpers/format'

const WARNING_TITLES: Record<BoardWarningKind, string> = {
  'cell-spread': 'Cell voltage spread',
  'battery-config-mismatch': 'Battery config mismatch',
  'footpad-disabled': 'Footpad sensor disabled',
  'lv-pushback-low': 'Low-voltage pushback too low',
  'hv-pushback-high': 'High-voltage pushback too high',
  'duty-pushback-high': 'Duty pushback too high',
}

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
}

export function warningTitle(kind: string): string {
  return WARNING_TITLES[kind as BoardWarningKind] ?? kind
}

export function warningDescription(kind: string): string | null {
  return WARNING_DESCRIPTIONS[kind as BoardWarningKind] ?? null
}

export function pendingWarnings(
  warnings: BoardWarning[],
  dismissedKinds: string[] | undefined,
): BoardWarning[] {
  if (!dismissedKinds?.length) return warnings
  return warnings.filter((w) => !dismissedKinds.includes(w.kind))
}

export function worstSeverity(warnings: BoardWarning[]): BoardWarningSeverity | null {
  if (warnings.length === 0) return null
  return warnings.some((w) => w.severity === 'critical') ? 'critical' : 'warn'
}

export interface WarningDetailEntry {
  label: string
  value: string
}

const CONFIG_DETAIL: Partial<
  Record<BoardWarningKind, { boundLabel: string; format: (n: number) => string }>
> = {
  'lv-pushback-low': { boundLabel: 'Safe minimum', format: fmtVolts },
  'hv-pushback-high': { boundLabel: 'Safe maximum', format: fmtVolts },
  'duty-pushback-high': { boundLabel: 'Safe maximum', format: fmtDutyPercent },
  'footpad-disabled': { boundLabel: '', format: () => '' },
}

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
