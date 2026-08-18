import { TouchableOpacity, StyleSheet, View } from 'react-native'

import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'

/**
 * Repeat cadences offered to the rider, with `Off` as the one-shot choice. Deliberately coarse: the
 * difference between 12s and 15s is not a choice anyone can make meaningfully in a settings screen,
 * and native floors the value regardless.
 */
const REPEAT_INTERVAL_CHOICES = [5, 10, 30, 60] as const

/** Repeat cadence for a single-threshold rule; `Off` is the one-shot choice. */
export function RepeatField({
  value,
  onChange,
}: {
  value: number | null
  onChange: (next: number | null) => void
}) {
  return (
    <View style={styles.dialField}>
      <Text style={styles.fieldLabel}>REPEAT</Text>
      <View style={styles.choiceRow}>
        <ChoiceButton label="Off" active={value == null} onPress={() => onChange(null)} />
        {REPEAT_INTERVAL_CHOICES.map((seconds) => (
          <ChoiceButton
            key={seconds}
            label={`${seconds}s`}
            active={value === seconds}
            onPress={() => onChange(seconds)}
          />
        ))}
      </View>
      <Text style={styles.fieldHint}>
        {value == null
          ? 'Announces once, then again only after it drops back down'
          : `Keeps announcing every ${value}s while past the threshold`}
      </Text>
    </View>
  )
}

export function ChoiceButton({
  label,
  active,
  onPress,
}: {
  label: string
  active: boolean
  onPress: () => void
}) {
  return (
    <TouchableOpacity style={[styles.choice, active && styles.choiceActive]} onPress={onPress}>
      <Text style={[styles.choiceText, active && styles.choiceTextActive]}>{label}</Text>
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  dialField: {
    gap: 6,
  },
  fieldLabel: {
    color: theme.palette.slate.textMuted,
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  choiceRow: {
    flexDirection: 'row',
    gap: 6,
  },
  fieldHint: {
    color: theme.palette.slate.textMuted,
    fontSize: 11,
    fontWeight: '500',
  },
  choice: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: theme.palette.slate.surfaceDeep,
  },
  choiceActive: {
    backgroundColor: theme.palette.sky.bg,
  },
  choiceText: {
    color: theme.palette.slate.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  choiceTextActive: {
    color: theme.palette.slate.textPrimary,
  },
})
