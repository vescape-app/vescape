/**
 * A rule's `soundType` read through the sound string grammar `kind(variant):sound`. Only the first
 * `:` after the kind and optional variant splits, so the sound part (TTS text) may contain `:`.
 * Strings outside the grammar (no `kind:` prefix) parse to null.
 *
 * Only `tts` has a typed reading today; `alert`, `geiger`, and `voice` plug in as new readings of
 * the same parsed parts.
 *
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/AlertSoundString.kt
 * @parity /modules/vescape-core/ios/alerts/AlertSoundString.swift
 */
export interface AlertSoundString {
  kind: string
  variant: string | null
  sound: string
}

const PATTERN = /^([a-z]+)(?:\(([^()]*)\))?:([\s\S]*)$/

export function parseAlertSoundString(raw: string): AlertSoundString | null {
  const match = PATTERN.exec(raw)
  if (!match) return null
  return { kind: match[1], variant: match[2] || null, sound: match[3] }
}

/**
 * Severity of a spoken announcement: picks the sound played once before the speech.
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
