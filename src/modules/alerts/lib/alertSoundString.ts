/**
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
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/AlertSoundString.kt `AlertSeverity`
 * @parity /modules/vescape-core/ios/alerts/AlertSoundString.swift `AlertSeverity`
 */
export const ALERT_SEVERITIES = ['info', 'warning', 'critical'] as const
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number]
export const ALERT_SEVERITY_DEFAULT: AlertSeverity = 'warning'

export interface TtsAlertSound {
  severity: AlertSeverity
  text: string
}

export function parseTtsAlertSound(spec: string): TtsAlertSound | null {
  const parsed = parseAlertSoundString(spec)
  if (parsed?.kind !== 'tts') return null
  const severity = ALERT_SEVERITIES.find((it) => it === parsed.variant) ?? ALERT_SEVERITY_DEFAULT
  return { severity, text: parsed.sound }
}

export function formatTtsAlertSound(severity: AlertSeverity, text: string): string {
  return `tts(${severity}):${text}`
}

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/AlertSoundString.kt `parseVoiceAlertSound`
 * @parity /modules/vescape-core/ios/alerts/AlertSoundString.swift `parseVoiceAlertSound`
 */
export interface VoiceAlertSound {
  severity: AlertSeverity
  key: string | null
  value: number | null
}

export function parseVoiceAlertSound(spec: string): VoiceAlertSound | null {
  const parsed = parseAlertSoundString(spec)
  if (parsed?.kind !== 'voice') return null
  const split = parsed.sound.indexOf(':')
  const key = split < 0 ? parsed.sound : parsed.sound.slice(0, split)
  const rawValue = split < 0 ? '' : parsed.sound.slice(split + 1)
  const value = rawValue.trim() === '' ? NaN : Number(rawValue)
  const severity = ALERT_SEVERITIES.find((it) => it === parsed.variant) ?? ALERT_SEVERITY_DEFAULT
  return { severity, key: key || null, value: Number.isFinite(value) ? value : null }
}

export function formatVoiceAlertSound(
  severity: AlertSeverity,
  key: string | null = null,
  value: number | null = null,
): string {
  if (key == null) return `voice(${severity}):`
  return value == null ? `voice(${severity}):${key}` : `voice(${severity}):${key}:${value}`
}

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/VoicePacks.kt `voiceKey`
 * @parity /modules/vescape-core/ios/alerts/VoicePacks.swift `voiceKey`
 */
export const VOICE_KEY_BY_CONTROL: Partial<Record<string, string>> = {
  battery: 'battery',
  'motor-temp': 'motorTemp',
  'controller-temp': 'controllerTemp',
  speed: 'speed',
  duty: 'dutyCycle',
}

export function customVoiceKey(controlId: string, hasBatteryConfig: boolean): string | null {
  if (controlId === 'battery' && !hasBatteryConfig) return null
  return VOICE_KEY_BY_CONTROL[controlId] ?? null
}

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
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/AlertSoundString.kt `parseSlotAlertSound`
 * @parity /modules/vescape-core/ios/alerts/AlertSoundString.swift `parseSlotAlertSound`
 */
export function parseSlotAlertSound(spec: string): SlotAlertSound {
  const parsed = parseAlertSoundString(spec)
  if (parsed?.kind === 'alert') {
    const raw =
      parsed.variant != null && /^[+-]?\d+$/.test(parsed.variant) ? Number(parsed.variant) : 1
    const count = Math.min(ALERT_BEEP_COUNT_RANGE.max, Math.max(ALERT_BEEP_COUNT_RANGE.min, raw))
    const severity = ALERT_SEVERITIES.find((it) => it === parsed.sound) ?? ALERT_SEVERITY_DEFAULT
    return { count, severity }
  }
  return { count: 1, severity: LEGACY_SEVERITY[spec] ?? ALERT_SEVERITY_DEFAULT }
}

export function formatSlotAlertSound(count: number, sound: AlertSeverity | MySoundRef): string {
  return `alert(${count}):${sound}`
}

export const ALERT_SEVERITY_LABELS: Record<AlertSeverity, string> = {
  info: 'Info',
  warning: 'Warning',
  critical: 'Critical',
}

export function slotAlertSoundLabel(spec: string): string {
  const { count, severity } = parseSlotAlertSound(spec)
  return `${count}× ${mySoundId(spec) ? 'My sound' : ALERT_SEVERITY_LABELS[severity]}`
}

/**
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
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/AlertSoundString.kt `parseGeigerAlertSound`
 * @parity /modules/vescape-core/ios/alerts/AlertSoundString.swift `parseGeigerAlertSound`
 */
export function parseGeigerAlertSound(spec: string): GeigerLevel | null {
  const legacy = LEGACY_GEIGER[spec]
  if (legacy) return legacy
  const parsed = parseAlertSoundString(spec)
  if (parsed?.kind !== 'geiger') return null
  return GEIGER_LEVELS.find((it) => it === parsed.sound) ?? 'soft'
}

export function formatGeigerAlertSound(level: GeigerLevel): string {
  return `geiger:${level}`
}

export type MySoundRef = `my:${string}`

export function mySoundRef(id: string): MySoundRef {
  return `my:${id}`
}

export function slotSoundPart(spec: string): AlertSeverity | MySoundRef {
  const id = mySoundId(spec)
  return id ? mySoundRef(id) : parseSlotAlertSound(spec).severity
}

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/AlertSoundString.kt `mySoundId`
 * @parity /modules/vescape-core/ios/alerts/AlertSoundString.swift `mySoundId`
 */
export function mySoundId(spec: string): string | null {
  const parsed = parseAlertSoundString(spec)
  if (parsed?.kind !== 'alert' && parsed?.kind !== 'geiger') return null
  if (!parsed.sound.startsWith('my:')) return null
  return parsed.sound.slice(3) || null
}

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/AlertSoundString.kt `AlertPresetSpec`
 * @parity /modules/vescape-core/ios/alerts/AlertSoundString.swift `AlertPresetSpec`
 */
export interface AlertPresetSpec {
  level: string
  options: [key: string, value: string][]
}

const PRESET_PATTERN = /^preset\(([^()]*)\)(?::([\s\S]*))?$/

export function parseAlertPresetSpec(raw: string): AlertPresetSpec | null {
  const match = PRESET_PATTERN.exec(raw)
  if (!match) return null
  const options = (match[2] ?? '').split(',').flatMap((entry): [string, string][] => {
    const separator = entry.indexOf('=')
    return separator > 0 ? [[entry.slice(0, separator), entry.slice(separator + 1)]] : []
  })
  return { level: match[1], options }
}

export function presetSpecOption(spec: AlertPresetSpec, key: string): string | null {
  return spec.options.find(([name]) => name === key)?.[1] ?? null
}

export function formatAlertPresetSpec({ level, options }: AlertPresetSpec): string {
  const tail = options.map(([key, value]) => `${key}=${value}`).join(',')
  return `preset(${level})${tail ? `:${tail}` : ''}`
}
