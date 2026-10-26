import { StyleSheet, TouchableOpacity, View } from 'react-native'
import { SpeakerHighIcon } from 'phosphor-react-native'
import { previewAlertSound } from 'vescape-core'

import { Text } from '@/components/base/Text'
import { IconButton } from '@/components/base/IconButton'
import { Input } from '@/components/forms/Input'
import { Switch } from '@/components/controls/Switch'
import { theme } from '@/constants/theme'
import type { DerivedBatteryConfig } from '@/modules/battery/lib/types'
import type { getAlertDialConfig } from '@/modules/alerts/lib/alertFormDefaults'
import { getMessagePlaceholders } from '@/modules/alerts/lib/alertFormDefaults'
import { SeverityField } from '@/modules/alerts/components/AlertFormFields'
import { useAlertMessageFormat } from '@/modules/alerts/hooks/useAlertMessageFormat'
import {
  type AlertSeverity,
  formatTtsAlertSound,
  formatVoiceAlertSound,
} from '@/modules/alerts/lib/alertSoundString'

/**
 * Severity select, then either the voice pack line for the metric (with the threshold as its value)
 * or, with TTS on, a spoken-message template and its placeholder chips; plus a preview of either.
 */
export function AlertMessageField({
  severity,
  onChangeSeverity,
  voiceKey,
  tts,
  onChangeTts,
  controlId,
  unit,
  threshold,
  dialConfig,
  batteryConfig,
  messageTemplate,
  onChangeTemplate,
}: {
  /** Played once ahead of the previewed speech, the same way a ride plays it. */
  severity: AlertSeverity
  onChangeSeverity: (next: AlertSeverity) => void
  /** Voice key of the metric; null when it has no voice lines, which forces TTS and hides the switch. */
  voiceKey: string | null
  /** TTS switch; ignored (always on) without a `voiceKey`. */
  tts: boolean
  onChangeTts: (next: boolean) => void
  controlId: string
  unit: string
  threshold: number
  dialConfig: ReturnType<typeof getAlertDialConfig>
  batteryConfig: DerivedBatteryConfig | null
  messageTemplate: string
  onChangeTemplate: (next: string | ((current: string) => string)) => void
}) {
  const formatMessage = useAlertMessageFormat()
  const speaksTts = tts || voiceKey == null
  const preview = (
    <IconButton
      icon={SpeakerHighIcon}
      size="sm"
      accessibilityLabel="Preview the spoken message"
      onPress={() =>
        previewAlertSound(
          !speaksTts && voiceKey
            ? formatVoiceAlertSound(severity, voiceKey, Math.round(threshold))
            : formatTtsAlertSound(
                severity,
                formatMessage(
                  messageTemplate,
                  threshold,
                  unit,
                  dialConfig,
                  controlId,
                  batteryConfig,
                ),
              ),
        )
      }
      style={styles.previewButton}
    />
  )
  return (
    <View style={styles.messageField}>
      <SeverityField value={severity} onChange={onChangeSeverity} />
      {voiceKey != null && (
        <View style={styles.ttsRow}>
          <View style={styles.ttsText}>
            <Text style={styles.fieldLabel}>TTS</Text>
            <Text style={styles.ttsHint}>
              {speaksTts
                ? 'Your text, spoken by the system voice.'
                : 'The voice pack line, with the threshold as its value.'}
            </Text>
          </View>
          {!speaksTts && preview}
          <Switch value={speaksTts} onValueChange={onChangeTts} />
        </View>
      )}
      {speaksTts && (
        <>
          <Text style={styles.fieldLabel}>TEMPLATE</Text>
          <Input
            value={messageTemplate}
            onChangeText={onChangeTemplate}
            multiline
            placeholder="e.g. Speed {value} {unit}"
            placeholderTextColor={theme.neutral.textDim}
            style={styles.templateInput}
          />
          <View style={styles.placeholderRow}>
            {getMessagePlaceholders(controlId, batteryConfig).map((ph) => (
              <TouchableOpacity
                key={ph}
                style={styles.placeholderChip}
                onPress={() => onChangeTemplate((t) => t + ph)}
              >
                <Text style={styles.placeholderChipText}>{ph}</Text>
              </TouchableOpacity>
            ))}
            {preview}
          </View>
        </>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  messageField: {
    gap: 8,
  },
  fieldLabel: {
    color: theme.neutral.textMuted,
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  templateInput: {
    minHeight: 72,
    textAlignVertical: 'top',
  },
  placeholderRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
  },
  previewButton: {
    marginLeft: 'auto',
  },
  ttsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  ttsText: {
    flex: 1,
    gap: 2,
  },
  ttsHint: {
    color: theme.neutral.textMuted,
    fontSize: 12,
  },
  placeholderChip: {
    backgroundColor: theme.alpha(theme.neutral.surfaceDeep, 0.85),
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.neutral.border,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  placeholderChipText: {
    color: theme.neutral.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
})
