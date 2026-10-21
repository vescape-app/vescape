import { useMemo } from 'react'
import { StyleSheet, View } from 'react-native'
import type { AlertTestRule } from 'vescape-core'

import { Text } from '@/components/base/Text'
import { Select } from '@/components/forms/Select'
import { SoundPicker } from '@/components/forms/SoundPicker'
import { theme } from '@/constants/theme'
import { geigerPickerSound, getPresetsForCategory } from '@/modules/alerts/lib/alertFormDefaults'
import { parseVoiceAlertSound } from '@/modules/alerts/lib/alertSoundString'
import type { PresetSoundSlot } from '@/modules/alerts/lib/boardAlertSettings'
import { EFFECTS_PACKS, matchingVoiceName, VOICE_PACKS } from '@/modules/settings/lib/appSounds'
import { useSettingsStore } from '@/modules/settings/store/settingsStore'

/**
 * A preset's own sound choices: the geiger tick level, and the packs it pins. Shown while the
 * level has rules; omitted handlers hide their control.
 */
export function PresetSoundControls({
  ruleSnapshot,
  geigerSound,
  onGeigerSoundChange,
  pins,
  onPinChange,
}: {
  ruleSnapshot: AlertTestRule[]
  geigerSound?: string | null
  onGeigerSoundChange?: (soundType: string) => void
  pins?: Partial<Record<PresetSoundSlot, string>>
  onPinChange?: (slot: PresetSoundSlot, pack: string | null) => void
}) {
  return (
    <>
      <PresetGeigerSound soundType={geigerSound} onChange={onGeigerSoundChange} />
      {ruleSnapshot.length === 0 || !onPinChange ? null : (
        <PresetPackSelects
          pins={pins ?? {}}
          speaks={ruleSnapshot.some((rule) => parseVoiceAlertSound(rule.soundType) != null)}
          onChange={onPinChange}
        />
      )}
    </>
  )
}

/** Soft / Mid / Hard for a range preset's ticks. */
function PresetGeigerSound({
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

const DEFAULT_PACK = ''

/**
 * Sound effects and Voice for one preset: Default follows the app-wide choice, a pack pins it.
 * Voice shows only for presets that speak.
 */
function PresetPackSelects({
  pins,
  speaks,
  onChange,
}: {
  pins: Partial<Record<PresetSoundSlot, string>>
  speaks: boolean
  onChange: (slot: PresetSoundSlot, pack: string | null) => void
}) {
  const soundPack = useSettingsStore((state) => state.soundPack)
  const voice = useSettingsStore((state) => state.voice)
  const effectsName = EFFECTS_PACKS.find((pack) => pack.id === soundPack)?.name ?? soundPack
  // Matching follows the effects this preset plays, pinned or app-wide.
  const voiceName =
    VOICE_PACKS.find((pack) => pack.id === voice)?.name ??
    matchingVoiceName(pins.effects ?? soundPack)
  const rows: {
    slot: PresetSoundSlot
    label: string
    fallback: string
    packs: readonly { id: string; name: string }[]
  }[] = [
    { slot: 'effects', label: 'Sound effects', fallback: effectsName, packs: EFFECTS_PACKS },
    ...(speaks
      ? [{ slot: 'voice' as const, label: 'Voice', fallback: voiceName, packs: VOICE_PACKS }]
      : []),
  ]
  return (
    <View style={styles.packSelects}>
      {rows.map((row) => (
        <View key={row.slot} style={styles.packRow}>
          <Text style={styles.packLabel}>{row.label}</Text>
          <Select
            options={[
              { label: `Default (${row.fallback})`, value: DEFAULT_PACK },
              ...row.packs.map((pack) => ({ label: pack.name, value: pack.id })),
            ]}
            value={pins[row.slot] ?? DEFAULT_PACK}
            onChange={(next) => onChange(row.slot, next === DEFAULT_PACK ? null : next)}
            style={styles.packSelect}
            testID={`alert-preset-${row.slot}-pack`}
          />
        </View>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  packSelects: { gap: 8 },
  packRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  packLabel: { color: theme.neutral.textPrimary, fontSize: 14, fontWeight: '600' },
  packSelect: { width: 170 },
})
