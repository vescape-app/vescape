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
 * critical, played once); anything unknown, including a not-yet-supported `my:` sound, plays the
 * warning sound once, so a rule is never silent.
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

export function formatSlotAlertSound(count: number, severity: AlertSeverity): string {
  return `alert(${count}):${severity}`
}

export const ALERT_SEVERITY_LABELS: Record<AlertSeverity, string> = {
  info: 'Info',
  warning: 'Warning',
  critical: 'Critical',
}

/** Short rule summary, e.g. `3× Warning`. */
export function slotAlertSoundLabel({ count, severity }: SlotAlertSound): string {
  return `${count}× ${ALERT_SEVERITY_LABELS[severity]}`
}
