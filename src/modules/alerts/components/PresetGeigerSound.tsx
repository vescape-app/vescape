import { useMemo } from 'react'

import { SoundPicker } from '@/components/forms/SoundPicker'
import { geigerPickerSound, getPresetsForCategory } from '@/modules/alerts/lib/alertFormDefaults'

/** Soft / Mid / Hard for a range preset's ticks; hidden without a geiger sound or handler. */
export function PresetGeigerSound({
  soundType,
  onChange,
}: {
  soundType?: string | null
  onChange?: (soundType: string) => void
}) {
  const sounds = useMemo(() => getPresetsForCategory('geiger'), [])
  if (!soundType || !onChange) return null
  return (
    <SoundPicker presets={sounds} selected={geigerPickerSound(soundType)} onSelect={onChange} />
  )
}
