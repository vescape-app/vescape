import { StyleSheet, View } from 'react-native'

import { Text } from '@/components/base/Text'
import { PillChoiceRow } from '@/components/forms/PillChoiceRow'
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
      <PillChoiceRow
        options={[
          { value: null, label: 'Off' },
          ...REPEAT_INTERVAL_CHOICES.map((seconds) => ({ value: seconds, label: `${seconds}s` })),
        ]}
        value={value}
        onChange={onChange}
        accent={theme.palette.green}
      />
      <Text style={styles.fieldHint}>
        {value == null
          ? 'Announces once, then again only after it drops back down'
          : `Keeps announcing every ${value}s while past the threshold`}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  dialField: {
    gap: 6,
  },
  fieldLabel: {
    color: theme.neutral.textMuted,
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  fieldHint: {
    color: theme.neutral.textMuted,
    fontSize: 11,
    fontWeight: '500',
  },
})
