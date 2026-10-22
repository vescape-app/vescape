import { useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { ShuffleIcon, SpeakerHighIcon } from 'phosphor-react-native'
import { previewAlertSound } from 'vescape-core'

import { Button } from '@/components/base/Button'
import { Text } from '@/components/base/Text'
import { SegmentedToggle } from '@/components/controls/SegmentedToggle'
import { Input } from '@/components/forms/Input'
import { theme } from '@/constants/theme'
import {
  ALERT_SEVERITIES,
  type AlertSeverity,
  formatVoiceAlertSound,
} from '@/modules/alerts/lib/alertSoundString'
import { resolvedVoiceId, VOICE_PACKS } from '@/modules/settings/lib/appSounds'
import { useSettingsStore } from '@/modules/settings/store/settingsStore'
import catalog from '../../../../scripts/alert-packs/catalog.json'

const VOICE_KEYS = Object.entries(catalog.voiceKeys) as [string, string | null][]
/** Range value types; the voice keys speak only these. */
const VALUE_RANGES: Record<string, { min: number; max: number }> = Object.fromEntries(
  Object.entries(catalog.values).filter(
    (entry): entry is [string, { min: number; max: number }] => !Array.isArray(entry[1]),
  ),
)

const randomInt = (min: number, max: number) => min + Math.floor(Math.random() * (max - min + 1))

/** Plays any voice pack line with a severity and value, or a random one. */
export function VoiceProbe() {
  const voice = useSettingsStore((state) => state.voice)
  const soundPack = useSettingsStore((state) => state.soundPack)
  const set = useSettingsStore((state) => state.set)
  const [key, setKey] = useState(VOICE_KEYS[0][0])
  const [severity, setSeverity] = useState<AlertSeverity>('warning')
  const [value, setValue] = useState('42')
  const valueType = catalog.voiceKeys[key as keyof typeof catalog.voiceKeys]
  const range = valueType ? VALUE_RANGES[valueType] : null

  const play = (nextKey: string, nextSeverity: AlertSeverity, nextValue: string) => {
    const number = Number(nextValue)
    const hasValue = VOICE_KEYS.find(([it]) => it === nextKey)?.[1] && nextValue.trim() !== ''
    previewAlertSound(
      formatVoiceAlertSound(
        nextSeverity,
        nextKey,
        hasValue && Number.isFinite(number) ? number : null,
      ),
    )
  }

  const playRandom = () => {
    const [nextKey, type] = VOICE_KEYS[randomInt(0, VOICE_KEYS.length - 1)]
    const nextSeverity = ALERT_SEVERITIES[randomInt(0, ALERT_SEVERITIES.length - 1)]
    const nextRange = type ? VALUE_RANGES[type] : null
    const nextValue = nextRange ? String(randomInt(nextRange.min, nextRange.max)) : ''
    setKey(nextKey)
    setSeverity(nextSeverity)
    if (nextRange) setValue(nextValue)
    play(nextKey, nextSeverity, nextValue)
  }

  return (
    <>
      <Text style={styles.sectionTitle}>Voice lines</Text>
      <View style={styles.card}>
        <SegmentedToggle
          options={VOICE_PACKS.map((pack) => ({ value: pack.id, label: pack.name }))}
          value={resolvedVoiceId(voice, soundPack)}
          onChange={(next) => void set('voice', next)}
          accent={theme.settingsIcon.sounds}
        />
        <View style={styles.keys}>
          {VOICE_KEYS.map(([it]) => (
            <Pressable
              key={it}
              style={[styles.chip, key === it && styles.chipActive]}
              onPress={() => {
                setKey(it)
                play(it, severity, value)
              }}
            >
              <Text style={[styles.chipText, key === it && styles.chipTextActive]}>{it}</Text>
            </Pressable>
          ))}
        </View>
        <SegmentedToggle
          options={ALERT_SEVERITIES.map((it) => ({ value: it, label: it }))}
          value={severity}
          onChange={setSeverity}
          accent={theme.settingsIcon.sounds}
        />
        {range && (
          <Input
            value={value}
            onChangeText={setValue}
            keyboardType="numbers-and-punctuation"
            placeholder={`${valueType} ${range.min}…${range.max}`}
          />
        )}
        <View style={styles.actions}>
          <Button
            label="Play"
            icon={SpeakerHighIcon}
            onPress={() => play(key, severity, value)}
            style={styles.action}
          />
          <Button
            label="Random"
            icon={ShuffleIcon}
            variant="secondary"
            onPress={playRandom}
            style={styles.action}
          />
        </View>
        <Text style={styles.hint}>
          {formatVoiceAlertSound(
            severity,
            key,
            range && value.trim() !== '' ? Number(value) : null,
          )}
        </Text>
      </View>
    </>
  )
}

const styles = StyleSheet.create({
  sectionTitle: {
    color: theme.neutral.textMuted,
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 8,
    marginBottom: 4,
    marginLeft: 4,
  },
  card: {
    backgroundColor: theme.neutral.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.neutral.border,
    padding: 14,
    gap: 12,
  },
  keys: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    backgroundColor: theme.neutral.surfaceDeep,
    borderWidth: 1,
    borderColor: theme.neutral.border,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  chipActive: {
    borderColor: theme.palette.sky.color,
  },
  chipText: {
    color: theme.neutral.textMuted,
    fontSize: 12,
  },
  chipTextActive: {
    color: theme.neutral.textPrimary,
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
  },
  action: {
    flex: 1,
  },
  hint: {
    color: theme.neutral.textDim,
    fontSize: 12,
    fontFamily: 'monospace',
  },
})
