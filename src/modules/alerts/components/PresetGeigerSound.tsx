import { useMemo } from 'react'

import { SoundPicker } from '@/components/forms/SoundPicker'
import { geigerPickerSound, getPresetsForCategory } from '@/modules/alerts/lib/alertFormDefaults'

/** Soft / Mid / Hard for a range preset's ticks; hidden without a geiger sound or handler. */
export function PresetGeigerSound({
  spec,
  onChange,
}: {
  spec?: string | null
  onChange?: (spec: string) => void
}) {
  const sounds = useMemo(() => getPresetsForCategory('geiger'), [])
  if (!spec || !onChange) return null
  return <SoundPicker presets={sounds} selected={geigerPickerSound(spec)} onSelect={onChange} />
}
