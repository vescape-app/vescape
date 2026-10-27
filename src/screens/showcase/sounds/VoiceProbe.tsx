import { useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { ShuffleIcon, SpeakerHighIcon } from 'phosphor-react-native'
import { previewAlertSound, previewWeatherAlert, type WeatherAlertPreviewKind } from 'vescape-core'

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

/** `weather.*` lines need a lead and percent; {@link WeatherProbe} plays them whole. */
const VOICE_KEYS = (Object.entries(catalog.voiceKeys) as [string, string | null][]).filter(
  ([key]) => !key.startsWith('weather.'),
)
const WEATHER_KINDS: WeatherAlertPreviewKind[] = ['storm', 'wind', 'rain']
const WEATHER_LEADS = [0, 15, 30, 45, 60, 90, 120, 150, 180]
const WEATHER_PERCENTS = [30, 50, 70, 90]
/** Kinds whose lines speak a percent; wind has none. */
const speaksPercent = (kind: WeatherAlertPreviewKind) => kind !== 'wind'
/** Range value types; the voice keys speak only these. */
const VALUE_RANGES: Record<string, { min: number; max: number }> = Object.fromEntries(
  Object.entries(catalog.values).filter(
    (entry): entry is [string, { min: number; max: number }] => !Array.isArray(entry[1]),
  ),
)

const randomInt = (min: number, max: number) => min + Math.floor(Math.random() * (max - min + 1))
const pick = <T,>(items: readonly T[]) => items[randomInt(0, items.length - 1)]

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable style={[styles.chip, active && styles.chipActive]} onPress={onPress}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  )
}

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
            <Chip
              key={it}
              label={it}
              active={key === it}
              onPress={() => {
                setKey(it)
                play(it, severity, value)
              }}
            />
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

/** Plays Weather Alert lines whole, built natively the way the evaluator speaks them. */
export function WeatherProbe() {
  const [kind, setKind] = useState<WeatherAlertPreviewKind>('rain')
  const [lead, setLead] = useState(150)
  const [percent, setPercent] = useState(30)

  const play = (nextKind: WeatherAlertPreviewKind, nextLead: number, nextPercent: number) =>
    previewWeatherAlert(nextKind, nextLead, speaksPercent(nextKind) ? nextPercent : null)

  const playRandom = () => {
    const nextKind = pick(WEATHER_KINDS)
    const nextLead = pick(WEATHER_LEADS)
    const nextPercent = pick(WEATHER_PERCENTS)
    setKind(nextKind)
    setLead(nextLead)
    setPercent(nextPercent)
    play(nextKind, nextLead, nextPercent)
  }

  return (
    <>
      <Text style={styles.sectionTitle}>Weather lines</Text>
      <View style={styles.card}>
        <View style={styles.keys}>
          {WEATHER_KINDS.map((it) => (
            <Chip
              key={it}
              label={it}
              active={kind === it}
              onPress={() => {
                setKind(it)
                play(it, lead, percent)
              }}
            />
          ))}
        </View>
        <View style={styles.keys}>
          {WEATHER_LEADS.map((it) => (
            <Chip
              key={it}
              label={it === 0 ? 'now' : `${it} min`}
              active={lead === it}
              onPress={() => {
                setLead(it)
                play(kind, it, percent)
              }}
            />
          ))}
        </View>
        {speaksPercent(kind) && (
          <View style={styles.keys}>
            {WEATHER_PERCENTS.map((it) => (
              <Chip
                key={it}
                label={`${it}%`}
                active={percent === it}
                onPress={() => {
                  setPercent(it)
                  play(kind, lead, it)
                }}
              />
            ))}
          </View>
        )}
        <View style={styles.actions}>
          <Button
            label="Play"
            icon={SpeakerHighIcon}
            onPress={() => play(kind, lead, percent)}
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
