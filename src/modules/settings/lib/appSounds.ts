import {
  playAppCue,
  type AppSoundCueId,
  type PackSoundSlot,
  type SoundOverrideSlot,
} from 'vescape-core'
import { useSettingsStore } from '@/modules/settings/store/settingsStore'

/**
 * Built-in effects packs: each fills the positive/info/warning/critical and geiger slots (optional
 * cue slots fall back to one of those natively), and names the voice
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

type VoicePackId = (typeof VOICE_PACKS)[number]['id']

/**
 * Voice pack the `voice` setting plays: `matching` (the default) follows effects pack `soundPack`
 * (its `pack.json` `voice`).
 *
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/VoicePacks.kt `voicePackId`
 * @parity /modules/vescape-core/ios/alerts/VoicePacks.swift `voicePackId`
 */
export function resolvedVoiceId(voice: string, soundPack: string): VoicePackId {
  const named = VOICE_PACKS.find((pack) => pack.id === voice)
  if (named) return named.id
  return EFFECTS_PACKS.find((pack) => pack.id === soundPack)?.voice ?? 'clean'
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

/** What each voice level does, and the spec previewed when it is picked. */
export const VOICE_LEVEL_INFO: Record<
  (typeof VOICE_LEVELS)[number]['value'],
  { description: string; preview: string }
> = {
  off: {
    description: 'Built-in alerts play their sound only, no speech.',
    preview: 'alert(1):warning',
  },
  standard: {
    description: 'Built-in alerts say what is wrong after their sound, like "Battery low… 20%".',
    preview: 'voice(warning):battery:20',
  },
  full: {
    description: 'Standard, plus spoken connection, ride end and Group Ride events.',
    preview: 'voice(info):link.connected',
  },
}

const SLOT_LABELS: Record<PackSoundSlot, string> = {
  'severity.positive': 'Positive',
  'severity.info': 'Info',
  'severity.warning': 'Warning',
  'severity.critical': 'Critical',
  'cue.on': 'Connect',
  'cue.off': 'Disconnect',
  'cue.ride.end': 'Ride end',
  'cue.groupRide.created': 'New Group Ride',
  'cue.groupRide.joined': 'Joined Group Ride',
}

const labeled = <T extends PackSoundSlot>(slot: T) => ({ slot, label: SLOT_LABELS[slot] })

/**
 * Effects slots a My sound can override, in settings order.
 *
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/MySounds.kt `SOUND_OVERRIDE_SLOTS`
 * @parity /modules/vescape-core/ios/alerts/MySounds.swift `soundOverrideSlots`
 */
export const SOUND_OVERRIDE_SLOTS: { slot: SoundOverrideSlot; label: string }[] = (
  [
    'severity.positive',
    'severity.info',
    'severity.warning',
    'severity.critical',
    'cue.on',
    'cue.off',
    'cue.groupRide.created',
    'cue.groupRide.joined',
  ] as const
).map(labeled)

/** Rows of an effects pack's preview strip in Settings › Sounds: its cues, then its severity sounds. */
export const PACK_PREVIEW_ROWS: { slot: PackSoundSlot; label: string }[][] = [
  (['cue.on', 'cue.off', 'cue.ride.end'] as const).map(labeled),
  (['cue.groupRide.created', 'cue.groupRide.joined'] as const).map(labeled),
  (['severity.positive', 'severity.info', 'severity.warning', 'severity.critical'] as const).map(
    labeled,
  ),
]

/** Play `cue` as the app does (effect, then voice at Full) unless app sounds are off. */
export function playSelectedAppSound(cue: AppSoundCueId) {
  if (useSettingsStore.getState().connectionSoundsEnabled) playAppCue(cue)
}
