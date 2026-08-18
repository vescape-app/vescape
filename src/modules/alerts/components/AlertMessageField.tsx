import { TouchableOpacity, StyleSheet, View } from 'react-native'
import { previewAlertSound } from 'vescape-core'

import { Text } from '@/components/base/Text'
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
        placeholderTextColor={theme.palette.slate.textDim}
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
      </View>
      <TouchableOpacity
        style={styles.previewButton}
        onPress={() =>
          previewAlertSound(
            `tts:${renderPreviewTemplate(messageTemplate, threshold, unit, dialConfig, controlId, batteryConfig)}`,
          )
        }
      >
        <Text style={styles.previewButtonText}>Preview</Text>
      </TouchableOpacity>
    </View>
  )
}

const styles = StyleSheet.create({
  messageField: {
    gap: 8,
  },
  fieldLabel: {
    color: theme.palette.slate.textMuted,
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
    gap: 6,
  },
  placeholderChip: {
    backgroundColor: theme.palette.slate.surface,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  placeholderChipText: {
    color: theme.palette.slate.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
  previewButton: {
    backgroundColor: theme.palette.slate.surface,
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: 'center',
  },
  previewButtonText: {
    color: theme.palette.slate.textPrimary,
    fontSize: 13,
    fontWeight: '600',
  },
})
