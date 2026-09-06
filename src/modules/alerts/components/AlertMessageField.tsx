import { StyleSheet, TouchableOpacity, View } from 'react-native'
import { SpeakerHighIcon } from 'phosphor-react-native'
import { previewAlertSound } from 'vescape-core'

import { Text } from '@/components/base/Text'
import { IconButton } from '@/components/base/IconButton'
import { Input } from '@/components/forms/Input'
import { theme } from '@/constants/theme'
import type { DerivedBatteryConfig } from '@/modules/battery/lib/types'
import type { getAlertDialConfig } from '@/modules/alerts/lib/alertFormDefaults'
import {
  getMessagePlaceholders,
  renderPreviewTemplate,
} from '@/modules/alerts/lib/alertFormDefaults'

/** Spoken-message template, its placeholder chips, and a preview of what will be said. */
export function AlertMessageField({
  controlId,
  unit,
  threshold,
  dialConfig,
  batteryConfig,
  messageTemplate,
  onChangeTemplate,
}: {
  controlId: string
  unit: string
  threshold: number
  dialConfig: ReturnType<typeof getAlertDialConfig>
  batteryConfig: DerivedBatteryConfig | null
  messageTemplate: string
  onChangeTemplate: (next: string | ((current: string) => string)) => void
}) {
  return (
    <View style={styles.messageField}>
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
        <IconButton
          icon={SpeakerHighIcon}
          size="sm"
          accessibilityLabel="Preview the spoken message"
          onPress={() =>
            previewAlertSound(
              `tts:${renderPreviewTemplate(messageTemplate, threshold, unit, dialConfig, controlId, batteryConfig)}`,
            )
          }
          style={styles.previewButton}
        />
      </View>
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
