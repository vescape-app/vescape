import { Pressable, StyleSheet, View } from 'react-native'
import { Text } from '@/components/base/Text'

import { theme } from '@/constants/theme'
import { type AlertSound, previewAlertSound } from 'vescape-core'
import { RadioIndicator } from '@/components/controls/RadioIndicator'
import { PillChoiceRow } from '@/components/forms/PillChoiceRow'

const MINE = '__mine__'

interface SoundPickerProps {
  presets: AlertSound[]
  /** Rider's own sounds; any count fits, listed as radios under one "Mine" segment. */
  mySounds?: AlertSound[]
  selected: string
  onSelect: (uri: string) => void
}

export function SoundPicker({ presets, mySounds = [], selected, onSelect }: SoundPickerProps) {
  const mine = mySounds.find((sound) => sound.uri === selected)

  const pick = (uri: string) => {
    onSelect(uri)
    previewAlertSound(uri)
  }

  return (
    <View style={styles.formField}>
      <Text style={styles.fieldLabel}>SOUND</Text>
      <PillChoiceRow
        options={[
          ...presets.map((preset) => ({ value: preset.uri, label: preset.name })),
          ...(mySounds.length > 0 ? [{ value: MINE, label: 'Mine' }] : []),
        ]}
        value={mine ? MINE : selected}
        onChange={(value) => {
          // Mine picks the first sound so the list below opens on a choice; re-tapping keeps it.
          if (value === MINE) {
            if (!mine) pick(mySounds[0].uri)
          } else pick(value)
        }}
      />
      {mine ? (
        <View style={styles.list}>
          {mySounds.map((sound) => {
            const isSelected = sound.uri === selected
            return (
              <Pressable
                key={sound.uri}
                style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                onPress={() => pick(sound.uri)}
                accessibilityRole="radio"
                accessibilityState={{ checked: isSelected }}
              >
                <RadioIndicator selected={isSelected} />
                <Text style={styles.rowText} numberOfLines={1}>
                  {sound.name}
                </Text>
              </Pressable>
            )
          })}
        </View>
      ) : null}
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
  list: {
    marginTop: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 44,
    paddingHorizontal: 4,
    borderRadius: 8,
  },
  rowPressed: {
    backgroundColor: theme.neutral.surfaceDeep,
  },
  rowText: {
    flexShrink: 1,
    color: theme.neutral.textPrimary,
    fontSize: 15,
    fontWeight: '500',
  },
})
