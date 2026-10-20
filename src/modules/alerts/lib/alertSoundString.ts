/**
 * A rule's `soundType` read through the sound string grammar `kind(variant):sound`. Only the first
 * `:` after the kind and optional variant splits, so the sound part (TTS text) may contain `:`.
 * Strings outside the grammar (no `kind:` prefix) parse to null.
 *
 * `tts` and `alert` have typed readings; `geiger` and `voice` plug in as new readings of the same
 * parsed parts.
 *
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/AlertSoundString.kt
 * @parity /modules/vescape-core/ios/alerts/AlertSoundString.swift
 */
export interface AlertSoundString {
  kind: string
  variant: string | null
  sound: string
}

import { ALERT_BEEP_COUNT_RANGE } from 'vescape-core'

const PATTERN = /^([a-z]+)(?:\(([^()]*)\))?:([\s\S]*)$/

export function parseAlertSoundString(raw: string): AlertSoundString | null {
  const match = PATTERN.exec(raw)
  if (!match) return null
  return { kind: match[1], variant: match[2] || null, sound: match[3] }
}

/**
 * Severity of an announcement: picks the active effects pack's `severity.<id>` slot, played before
 * speech or as an alert rule's sound.
 *
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/AlertSoundString.kt `AlertSeverity`
 * @parity /modules/vescape-core/ios/alerts/AlertSoundString.swift `AlertSeverity`
 */
export const ALERT_SEVERITIES = ['info', 'warning', 'critical'] as const
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number]
export const ALERT_SEVERITY_DEFAULT: AlertSeverity = 'warning'

/** `tts(severity):text` — the severity sound once, then system TTS speaking `text`. */
export interface TtsAlertSound {
  severity: AlertSeverity
  text: string
}

export function parseTtsAlertSound(soundType: string): TtsAlertSound | null {
  const parsed = parseAlertSoundString(soundType)
  if (parsed?.kind !== 'tts') return null
  const severity = ALERT_SEVERITIES.find((it) => it === parsed.variant) ?? ALERT_SEVERITY_DEFAULT
  return { severity, text: parsed.sound }
}

export function formatTtsAlertSound(severity: AlertSeverity, text: string): string {
  return `tts(${severity}):${text}`
}

/** `alert(count):severity` — the active effects pack's severity sound, `count` times. */
export interface SlotAlertSound {
  count: number
  severity: AlertSeverity
}

const LEGACY_SEVERITY: Record<string, AlertSeverity> = {
  'preset:notify': 'info',
  notify: 'info',
  pulse: 'info',
  'preset:urgent': 'critical',
  urgent: 'critical',
}

/**
 * Read any non-TTS single-alert `soundType` as a slot sound. `alert:` means one play. Strings from
 * before the grammar map onto the matching severity (`preset:notify|beep|urgent` → info, warning,
 * critical, played once); anything unknown plays the warning sound once, so a rule is never silent.
 * A `my:<id>` sound reads as warning too: the fallback when that My sound is gone (see `mySoundId`).
 *
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/AlertSoundString.kt `parseSlotAlertSound`
 * @parity /modules/vescape-core/ios/alerts/AlertSoundString.swift `parseSlotAlertSound`
 */
export function parseSlotAlertSound(soundType: string): SlotAlertSound {
  const parsed = parseAlertSoundString(soundType)
  if (parsed?.kind === 'alert') {
    const raw =
      parsed.variant != null && /^[+-]?\d+$/.test(parsed.variant) ? Number(parsed.variant) : 1
    const count = Math.min(ALERT_BEEP_COUNT_RANGE.max, Math.max(ALERT_BEEP_COUNT_RANGE.min, raw))
    const severity = ALERT_SEVERITIES.find((it) => it === parsed.sound) ?? ALERT_SEVERITY_DEFAULT
    return { count, severity }
  }
  return { count: 1, severity: LEGACY_SEVERITY[soundType] ?? ALERT_SEVERITY_DEFAULT }
}

/** `sound` is a severity or a `my:<id>` My sound. */
export function formatSlotAlertSound(count: number, sound: AlertSeverity | MySoundRef): string {
  return `alert(${count}):${sound}`
}

export const ALERT_SEVERITY_LABELS: Record<AlertSeverity, string> = {
  info: 'Info',
  warning: 'Warning',
  critical: 'Critical',
}

/** Short single rule summary, e.g. `3× Warning` or `2× My sound`. */
export function slotAlertSoundLabel(soundType: string): string {
  const { count, severity } = parseSlotAlertSound(soundType)
  return `${count}× ${mySoundId(soundType) ? 'My sound' : ALERT_SEVERITY_LABELS[severity]}`
}

/**
 * Tick level of a geiger (range) rule: picks the active effects pack's `geiger.<id>` slot.
 *
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/AlertSoundString.kt `GeigerLevel`
 * @parity /modules/vescape-core/ios/alerts/AlertSoundString.swift `GeigerLevel`
 */
export const GEIGER_LEVELS = ['soft', 'mid', 'hard'] as const
export type GeigerLevel = (typeof GEIGER_LEVELS)[number]

const LEGACY_GEIGER: Record<string, GeigerLevel> = {
  'preset:tick': 'soft',
  'preset:tick_hard': 'mid',
  'preset:gamma': 'hard',
  'preset:sustained': 'hard',
}

/**
 * `geiger:level` — a range rule's tick level, or null when `soundType` is not a geiger sound.
 * Strings from before the grammar map `preset:tick|tick_hard|gamma|sustained` → soft, mid, hard,
 * hard. An unknown level ticks soft, as does `geiger:my:<id>` when that My sound is gone.
 *
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/AlertSoundString.kt `parseGeigerAlertSound`
 * @parity /modules/vescape-core/ios/alerts/AlertSoundString.swift `parseGeigerAlertSound`
 */
export function parseGeigerAlertSound(soundType: string): GeigerLevel | null {
  const legacy = LEGACY_GEIGER[soundType]
  if (legacy) return legacy
  const parsed = parseAlertSoundString(soundType)
  if (parsed?.kind !== 'geiger') return null
  return GEIGER_LEVELS.find((it) => it === parsed.sound) ?? 'soft'
}

export function formatGeigerAlertSound(level: GeigerLevel): string {
  return `geiger:${level}`
}

/** The sound part naming a My sound. */
export type MySoundRef = `my:${string}`

export function mySoundRef(id: string): MySoundRef {
  return `my:${id}`
}

/** Sound part of a single rule: its My sound when it names one, else its severity. */
export function slotSoundPart(soundType: string): AlertSeverity | MySoundRef {
  const id = mySoundId(soundType)
  return id ? mySoundRef(id) : parseSlotAlertSound(soundType).severity
}

/**
 * My sound id of an `alert(count):my:<id>` or `geiger:my:<id>` sound, else null. Native plays it
 * when the sound still exists and falls back to the parsed pack slot otherwise, never silence.
 *
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/AlertSoundString.kt `mySoundId`
 * @parity /modules/vescape-core/ios/alerts/AlertSoundString.swift `mySoundId`
 */
export function mySoundId(soundType: string): string | null {
  const parsed = parseAlertSoundString(soundType)
  if (parsed?.kind !== 'alert' && parsed?.kind !== 'geiger') return null
  if (!parsed.sound.startsWith('my:')) return null
  return parsed.sound.slice(3) || null
}
