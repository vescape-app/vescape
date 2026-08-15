import { StyleSheet, TouchableOpacity, View } from 'react-native'
import { Text } from '@/components/base/Text'

import { theme } from '@/constants/theme'
import { type AlertSound, previewAlertSound } from 'vescape-core'

interface SoundPickerProps {
  presets: AlertSound[]
  selected: string
  onSelect: (uri: string) => void
}

export function SoundPicker({ presets, selected, onSelect }: SoundPickerProps) {
  return (
    <View style={styles.formField}>
      <Text style={styles.fieldLabel}>SOUND</Text>
      <View style={styles.soundRow}>
        {presets.map((preset) => {
          const active = selected === preset.uri
          return (
            <TouchableOpacity
              key={preset.uri}
              style={[styles.soundOption, active && styles.soundOptionActive]}
              onPress={() => {
                onSelect(preset.uri)
                previewAlertSound(preset.uri)
              }}
            >
              <Text style={[styles.soundOptionText, active && styles.soundOptionTextActive]}>
                {preset.name}
              </Text>
            </TouchableOpacity>
          )
        })}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  formField: {
    gap: 6,
  },
  fieldLabel: {
    color: theme.neutral.textMuted,
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  soundRow: {
    flexDirection: 'row',
    gap: 8,
  },
  soundOption: {
    flex: 1,
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.control.border,
    backgroundColor: theme.control.background,
    paddingVertical: 10,
  },
  soundOptionActive: {
    borderColor: theme.palette.sky.color,
    backgroundColor: theme.control.backgroundPressed,
  },
  soundOptionText: {
    color: theme.control.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  soundOptionTextActive: {
    color: theme.control.text,
  },
})
