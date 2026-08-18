import { useCallback, useState } from 'react'
import { Pressable, StyleSheet, TextInput, View } from 'react-native'
import { SpeakerHighIcon } from 'phosphor-react-native'
import { previewAlertSound } from 'vescape-core'

import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'

const TTS_EXAMPLES = [
  'Battery {voltage} volts, {percent}%',
  '{value} {unit}',
  'Warning! {value} {unit}',
]

/** Speaks an alert message template, so placeholder substitution can be heard. */
export function TtsProbe() {
  const [ttsTemplate, setTtsTemplate] = useState('Battery {voltage} volts, {percent}%')

  const handleSpeakTts = useCallback(() => {
    previewAlertSound(`tts:${ttsTemplate}`)
  }, [ttsTemplate])

  return (
    <>
      <Text style={styles.sectionTitle}>Message Alert (TTS)</Text>
      <View style={styles.card}>
        <Text style={styles.ttsHint}>
          Placeholders: {'{value}'} {'{threshold}'} {'{unit}'} — battery only: {'{voltage}'}{' '}
          {'{percent}'}
        </Text>
        <View style={styles.ttsExamples}>
          {TTS_EXAMPLES.map((ex) => (
            <Pressable
              key={ex}
              style={[styles.ttsChip, ttsTemplate === ex && styles.ttsChipActive]}
              onPress={() => setTtsTemplate(ex)}
            >
              <Text style={[styles.ttsChipText, ttsTemplate === ex && styles.ttsChipTextActive]}>
                {ex}
              </Text>
            </Pressable>
          ))}
        </View>
        <TextInput
          style={styles.ttsInput}
          value={ttsTemplate}
          onChangeText={setTtsTemplate}
          placeholder="Enter template…"
          placeholderTextColor={theme.palette.slate.textDim}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Pressable style={styles.playButton} onPress={handleSpeakTts}>
          <SpeakerHighIcon size={20} color={theme.palette.sky.bg} weight="fill" />
          <Text style={styles.playButtonText}>Speak</Text>
        </Pressable>
      </View>
    </>
  )
}

const styles = StyleSheet.create({
  sectionTitle: {
    color: theme.palette.slate.textMuted,
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 8,
    marginBottom: 4,
    marginLeft: 4,
  },
  card: {
    backgroundColor: theme.palette.slate.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.palette.slate.border,
    overflow: 'hidden',
    padding: 14,
  },
  ttsHint: {
    color: theme.palette.slate.textDim,
    fontSize: 11,
    marginBottom: 10,
    lineHeight: 16,
  },
  ttsExamples: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 10,
  },
  ttsChip: {
    backgroundColor: theme.palette.slate.surfaceDeep,
    borderWidth: 1,
    borderColor: theme.palette.slate.border,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  ttsChipActive: {
    borderColor: theme.palette.sky.color,
    backgroundColor: theme.palette.sky.bg,
  },
  ttsChipText: {
    color: theme.palette.slate.textMuted,
    fontSize: 11,
    fontWeight: '600',
  },
  ttsChipTextActive: {
    color: theme.palette.slate.textPrimary,
  },
  ttsInput: {
    backgroundColor: theme.palette.slate.surfaceDeep,
    borderWidth: 1,
    borderColor: theme.palette.slate.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: theme.palette.slate.textPrimary,
    fontSize: 13,
    marginBottom: 12,
    fontFamily: 'monospace',
  },
  playButton: {
    backgroundColor: theme.palette.sky.color,
    borderRadius: 8,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  playButtonText: {
    color: theme.palette.sky.bg,
    fontSize: 15,
    fontWeight: '700',
  },
})
