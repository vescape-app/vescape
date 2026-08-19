import { useEffect } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import type { Icon } from 'phosphor-react-native'

import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'
import { useResolvedNeutralColors } from '@/hooks/useTheme'

const CHOICE_ANIMATION = { duration: 180 } as const

interface PillChoiceOption<T> {
  value: T
  label: string
  icon?: Icon
}

interface PillChoiceAccent {
  bg: string
  border: string
  color: string
}

interface PillChoiceRowProps<T extends string | number | null> {
  options: readonly PillChoiceOption<T>[]
  value: T
  onChange: (value: T) => void
  /** Highlight fill + border + active text colour. Defaults to the sky accent. */
  accent?: PillChoiceAccent
  disabled?: boolean
}

/**
 * A one-row segmented pill with a sliding highlight — the same selector the alert presets use.
 * Picks one of several short options; the active segment is outlined and tinted, inactive ones
 * stay muted so the current choice reads at a glance.
 */
export function PillChoiceRow<T extends string | number | null>({
  options,
  value,
  onChange,
  accent = theme.palette.sky,
  disabled,
}: PillChoiceRowProps<T>) {
  const neutral = useResolvedNeutralColors()
  const activeIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  )
  const progress = useSharedValue(activeIndex)

  useEffect(() => {
    progress.value = withTiming(activeIndex, CHOICE_ANIMATION)
  }, [activeIndex, progress])

  const highlightStyle = useAnimatedStyle(
    () => ({
      left: `${(progress.value / options.length) * 100}%`,
    }),
    [],
  )

  return (
    <View style={[styles.track, disabled && styles.disabled]}>
      <Animated.View
        style={[styles.highlightSlot, { width: `${100 / options.length}%` }, highlightStyle]}
      >
        <Animated.View
          style={[styles.highlight, { backgroundColor: accent.bg, borderColor: accent.border }]}
        />
      </Animated.View>
      {options.map((option) => {
        const active = option.value === value
        const tone = active ? accent.color : neutral.textMuted
        return (
          <Pressable
            key={String(option.value)}
            style={styles.segment}
            accessibilityRole="button"
            accessibilityState={{ selected: active, disabled }}
            disabled={disabled}
            onPress={() => onChange(option.value)}
          >
            {option.icon ? (
              <option.icon size={14} color={tone} weight={active ? 'fill' : 'regular'} />
            ) : null}
            <Text style={[styles.label, { color: tone }]} numberOfLines={1}>
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
    height: 38,
    borderRadius: 19,
    backgroundColor: theme.alpha(theme.neutral.surfaceDeep, 0.85),
    borderWidth: 1,
    borderColor: theme.alpha(theme.palette.slate.light, 0.3),
    position: 'relative',
    overflow: 'hidden',
  },
  disabled: {
    opacity: 0.45,
  },
  highlightSlot: {
    position: 'absolute',
    top: 2,
    bottom: 2,
  },
  highlight: {
    flex: 1,
    marginHorizontal: 1,
    borderRadius: 16,
    borderWidth: 1,
  },
  segment: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 5,
    paddingHorizontal: 4,
  },
  label: {
    fontSize: 13,
    fontWeight: '800',
  },
})
