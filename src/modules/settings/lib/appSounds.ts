import { playAppSound, type SoundOverrideSlot } from 'vescape-core'
import { useSettingsStore } from '@/modules/settings/store/settingsStore'

/**
 * Built-in effects packs: each fills every severity, cue, and geiger slot. The `soundPack` setting
 * names one of them.
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
 * App cues the app plays by id (`playAppSound`).
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

/**
 * Effects slots a My sound can override, in settings order.
 *
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/MySounds.kt `SOUND_OVERRIDE_SLOTS`
 * @parity /modules/vescape-core/ios/alerts/MySounds.swift `soundOverrideSlots`
 */
export const SOUND_OVERRIDE_SLOTS: { slot: SoundOverrideSlot; label: string }[] = [
  { slot: 'severity.info', label: 'Info' },
  { slot: 'severity.warning', label: 'Warning' },
  { slot: 'severity.critical', label: 'Critical' },
  { slot: 'cue.on', label: 'Connect' },
  { slot: 'cue.off', label: 'Disconnect' },
  { slot: 'cue.error', label: 'Error' },
  { slot: 'cue.groupRide.created', label: 'New Group Ride' },
  { slot: 'cue.groupRide.joined', label: 'Rider joined Group Ride' },
]

export type AppSoundCue = (typeof APP_SOUND_CUES)[number]['id']

export function playSelectedAppSound(cue: AppSoundCue) {
  const { connectionSoundsEnabled, soundPack } = useSettingsStore.getState()
  if (connectionSoundsEnabled) playAppSound(soundPack, cue)
}
