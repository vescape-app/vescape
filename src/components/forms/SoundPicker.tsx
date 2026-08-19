import { StyleSheet, View } from 'react-native'
import { Text } from '@/components/base/Text'

import { theme } from '@/constants/theme'
import { type AlertSound, previewAlertSound } from 'vescape-core'
import { PillChoiceRow } from '@/components/forms/PillChoiceRow'

interface SoundPickerProps {
  presets: AlertSound[]
  selected: string
  onSelect: (uri: string) => void
}

export function SoundPicker({ presets, selected, onSelect }: SoundPickerProps) {
  return (
    <View style={styles.formField}>
      <Text style={styles.fieldLabel}>SOUND</Text>
      <PillChoiceRow
        options={presets.map((preset) => ({ value: preset.uri, label: preset.name }))}
        value={selected}
        onChange={(uri) => {
          onSelect(uri)
          previewAlertSound(uri)
        }}
      />
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
})
