import { playAppCue, type AppSoundCueId, type SoundOverrideSlot } from 'vescape-core'
import { useSettingsStore } from '@/modules/settings/store/settingsStore'

/**
 * Built-in effects packs: each fills every severity, cue, and geiger slot, and names the voice
 * `Matching` plays (its `pack.json` `voice`). The `soundPack` setting names one of them.
 *
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/EffectsPacks.kt
 * @parity /modules/vescape-core/ios/alerts/EffectsPacks.swift
 */
export const EFFECTS_PACKS = [
  { id: 'retro', name: 'Retro', voice: 'clean' },
  { id: 'simple', name: 'Simple', voice: 'clean' },
  { id: 'hev', name: 'HEV', voice: 'hev' },
  { id: 'clean', name: 'Clean', voice: 'clean' },
] as const

/**
 * Built-in voice packs: lines and value clips spoken after the severity sound.
 *
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/VoicePacks.kt
 * @parity /modules/vescape-core/ios/alerts/VoicePacks.swift
 */
export const VOICE_PACKS = [
  { id: 'hev', name: 'HEV' },
  { id: 'clean', name: 'Clean' },
] as const

/** Name of the voice `Matching` plays with effects pack `soundPack` (its `pack.json` `voice`). */
export function matchingVoiceName(soundPack: string): string {
  const id = EFFECTS_PACKS.find((pack) => pack.id === soundPack)?.voice ?? 'clean'
  return VOICE_PACKS.find((pack) => pack.id === id)?.name ?? 'Clean'
}

/**
 * Voice level options.
 *
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/VoicePacks.kt `VOICE_LEVELS`
 * @parity /modules/vescape-core/ios/alerts/VoicePacks.swift `voiceLevels`
 */
export const VOICE_LEVELS = [
  { value: 'off', label: 'Off' },
  { value: 'standard', label: 'Standard' },
  { value: 'full', label: 'Full' },
] as const

/**
 * App cues the app plays by id (`playAppSound`, `playAppCue`): board and ride cues, then Group
 * Ride events.
 *
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/EffectsPacks.kt `appCueSlot`
 * @parity /modules/vescape-core/ios/alerts/EffectsPacks.swift `appCueSlot`
 */
export const APP_SOUND_CUES: { id: AppSoundCueId; label: string; groupRide?: true }[] = [
  { id: 'on', label: 'Connect' },
  { id: 'off', label: 'Disconnect' },
  { id: 'error', label: 'Error' },
  { id: 'ride.end', label: 'Ride end' },
  { id: 'groupRide.created', label: 'New Group Ride', groupRide: true },
  { id: 'groupRide.joined', label: 'Joined Group Ride', groupRide: true },
  { id: 'groupRide.riderJoined', label: 'Rider joined', groupRide: true },
  { id: 'groupRide.riderLeft', label: 'Rider left', groupRide: true },
  { id: 'groupRide.lost', label: 'Group Ride lost', groupRide: true },
  { id: 'groupRide.restored', label: 'Group Ride restored', groupRide: true },
]

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
  { slot: 'cue.groupRide.joined', label: 'Joined Group Ride' },
  { slot: 'cue.groupRide.riderJoined', label: 'Rider joined Group Ride' },
  { slot: 'cue.groupRide.riderLeft', label: 'Rider left Group Ride' },
  { slot: 'cue.groupRide.lost', label: 'Group Ride lost' },
  { slot: 'cue.groupRide.restored', label: 'Group Ride restored' },
]

/** Play `cue` as the app does (effect, then voice at Full) unless app sounds are off. */
export function playSelectedAppSound(cue: AppSoundCueId) {
  if (useSettingsStore.getState().connectionSoundsEnabled) playAppCue(cue)
}
