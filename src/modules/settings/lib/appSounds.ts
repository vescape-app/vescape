import type { PackSoundSlot, SoundOverrideSlot } from 'vescape-core'

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/EffectsPacks.kt
 * @parity /modules/vescape-core/ios/alerts/EffectsPacks.swift
 */
export const EFFECTS_PACKS = [
  { id: 'arc', name: 'Arc', voice: 'nova' },
  { id: 'pulse', name: 'Pulse', voice: 'nova' },
  { id: 'hev', name: 'HEV', voice: 'radio' },
] as const

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/VoicePacks.kt
 * @parity /modules/vescape-core/ios/alerts/VoicePacks.swift
 */
export const VOICE_PACKS = [
  { id: 'nova', name: 'Nova' },
  { id: 'radio', name: 'Radio' },
  { id: 'nicole', name: 'Nicole' },
] as const

type VoicePackId = (typeof VOICE_PACKS)[number]['id']

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/VoicePacks.kt `voicePackId`
 * @parity /modules/vescape-core/ios/alerts/VoicePacks.swift `voicePackId`
 */
export function resolvedVoiceId(voice: string, soundPack: string): VoicePackId {
  const named = VOICE_PACKS.find((pack) => pack.id === voice)
  if (named) return named.id
  return EFFECTS_PACKS.find((pack) => pack.id === soundPack)?.voice ?? 'nova'
}

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/VoicePacks.kt `VOICE_LEVELS`
 * @parity /modules/vescape-core/ios/alerts/VoicePacks.swift `voiceLevels`
 */
export const VOICE_LEVELS = [
  { value: 'off', label: 'Off' },
  { value: 'minimal', label: 'Minimal' },
  { value: 'standard', label: 'Standard' },
  { value: 'full', label: 'Full' },
] as const

export const VOICE_LEVEL_INFO: Record<
  (typeof VOICE_LEVELS)[number]['value'],
  { description: string; preview: string }
> = {
  off: {
    description: 'Alert sounds only, no speech.',
    preview: 'alert(1):critical',
  },
  minimal: {
    description: 'As short as possible.',
    preview: 'voice(warning):motorTemp:75',
  },
  standard: {
    description: 'Clear, informative lines that also say how serious it is.',
    preview: 'voice(warning):motorTemp:75',
  },
  full: {
    description:
      'More variety and the odd remark. Also speaks connection, ride end and Group Ride.',
    preview: 'voice(warning):motorTemp:75',
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

export const PACK_PREVIEW_ROWS: { slot: PackSoundSlot; label: string }[][] = [
  (['cue.on', 'cue.off', 'cue.ride.end'] as const).map(labeled),
  (['cue.groupRide.created', 'cue.groupRide.joined'] as const).map(labeled),
  (['severity.positive', 'severity.info', 'severity.warning', 'severity.critical'] as const).map(
    labeled,
  ),
]
