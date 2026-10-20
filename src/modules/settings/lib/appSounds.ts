import { playAppSound } from 'vescape-core'
import { useSettingsStore } from '@/modules/settings/store/settingsStore'

/**
 * Built-in effects packs: each fills every severity, cue, and geiger slot. The `soundPack` setting
 * names one of them or a custom app sound pack.
 *
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/EffectsPacks.kt
 * @parity /modules/vescape-core/ios/alerts/EffectsPacks.swift
 */
export const EFFECTS_PACKS = [
  { id: 'retro', name: 'Retro' },
  { id: 'simple', name: 'Simple' },
  { id: 'hev', name: 'HEV' },
  { id: 'clean', name: 'Clean' },
] as const

/**
 * App cues a custom app sound pack can replace.
 *
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/EffectsPacks.kt `appCueSlot`
 * @parity /modules/vescape-core/ios/alerts/EffectsPacks.swift `appCueSlot`
 */
export const APP_SOUND_CUES = [
  { id: 'on', label: 'Connect' },
  { id: 'off', label: 'Disconnect' },
  { id: 'error', label: 'Error' },
  { id: 'created', label: 'New Group Ride' },
  { id: 'join', label: 'Rider joined Group Ride' },
] as const

export type AppSoundCue = (typeof APP_SOUND_CUES)[number]['id']

export function playSelectedAppSound(cue: AppSoundCue) {
  const { connectionSoundsEnabled, soundPack } = useSettingsStore.getState()
  if (connectionSoundsEnabled) playAppSound(soundPack, cue)
}
