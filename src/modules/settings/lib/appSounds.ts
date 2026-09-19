import { playAppSound } from 'vescape-core'
import { useSettingsStore } from '@/modules/settings/store/settingsStore'

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
