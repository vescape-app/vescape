import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'

import { Text } from '@/components/base/Text'
import { interaction, theme } from '@/constants/theme'

export interface SegmentedOption<T extends string> {
  value: T
  label: string
}

interface SegmentedToggleProps<T extends string> {
  options: SegmentedOption<T>[]
  value: T
  onChange: (value: T) => void
  /** Tint of the selected segment. */
  accent?: string
  /** Surface the toggle sits on. Controls default to navy; secondary cards use adaptive neutrals. */
  variant?: 'control' | 'secondary'
  style?: StyleProp<ViewStyle>
  testID?: string
}

/**
 * A compact pill switch between a few mutually exclusive views of the same content — the two or
 * three options are always visible, unlike a Select where the alternatives are hidden behind a tap.
 */
export function SegmentedToggle<T extends string>({
  options,
  value,
  onChange,
  accent = theme.palette.sky.color,
  variant = 'control',
  style,
  testID,
}: SegmentedToggleProps<T>) {
  const secondary = variant === 'secondary'

  return (
    <View style={[styles.track, secondary && styles.secondaryTrack, style]} testID={testID}>
      {options.map((option) => {
        const selected = option.value === value
        return (
          <Pressable
            key={option.value}
            style={({ pressed }) => [
              styles.segment,
              selected && { backgroundColor: theme.alpha(accent, 0.12) },
              pressed && !selected && styles.pressed,
            ]}
            onPress={() => onChange(option.value)}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={option.label}
          >
            <Text
              style={[
                styles.label,
                secondary && styles.secondaryLabel,
                selected && styles.labelSelected,
                selected && secondary && { color: accent },
              ]}
              numberOfLines={1}
            >
              {option.label}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    backgroundColor: theme.alpha(theme.palette.mono.black, 0.3),
    borderColor: theme.palette.slate.border,
    borderWidth: 1,
    borderRadius: 999,
    padding: 3,
  },
  segment: {
    minHeight: 34,
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderRadius: 999,
  },
  pressed: {
    backgroundColor: interaction.pressedBg,
  },
  label: {
    color: theme.palette.slate.textMuted,
    fontSize: 12,
    fontWeight: '700',
  },
  labelSelected: {
    color: theme.palette.slate.textPrimary,
  },
  secondaryTrack: {
    backgroundColor: theme.neutral.bg,
    borderColor: theme.neutral.border,
  },
  secondaryLabel: {
    color: theme.neutral.textSecondary,
  },
})
