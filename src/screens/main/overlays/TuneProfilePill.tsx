import { useEffect } from 'react'
import { Pressable, StyleSheet } from 'react-native'
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated'
import type { Icon } from 'phosphor-react-native'

import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'
import type { tuneProfileColorTheme } from '@/modules/tune/components/TuneProfileMetadataModal'

const PROFILE_OPTION_WIDTH = 46
const PROFILE_ACTIVE_WIDTH = 126
const PROFILE_ANIMATION = { duration: 180 } as const
const AnimatedText = Animated.createAnimatedComponent(Text)

interface TuneProfilePillProps {
  label: string
  icon: Icon
  active: boolean
  color: ReturnType<typeof tuneProfileColorTheme>
  onPress: () => void
}

export function TuneProfilePill({
  label,
  icon: IconComponent,
  active,
  color,
  onPress,
}: TuneProfilePillProps) {
  const fadedColor = theme.alpha(color.color, 0.6)
  const activeProgress = useSharedValue(active ? 1 : 0)

  useEffect(() => {
    activeProgress.value = withTiming(active ? 1 : 0, PROFILE_ANIMATION)
  }, [active, activeProgress])

  const frameStyle = useAnimatedStyle(
    () => ({
      width:
        PROFILE_OPTION_WIDTH + (PROFILE_ACTIVE_WIDTH - PROFILE_OPTION_WIDTH) * activeProgress.value,
      backgroundColor: interpolateColor(
        activeProgress.value,
        [0, 1],
        [theme.palette.slate.surfaceDeep, color.bg],
      ),
      borderColor: interpolateColor(
        activeProgress.value,
        [0, 1],
        [theme.palette.slate.border, color.border],
      ),
    }),
    [color.bg, color.border],
  )
  const labelStyle = useAnimatedStyle(
    () => ({
      opacity: activeProgress.value,
      maxWidth: PROFILE_ACTIVE_WIDTH * activeProgress.value,
      marginLeft: 7 * activeProgress.value,
    }),
    [],
  )

  return (
    <Animated.View style={[styles.profilePill, frameStyle]}>
      <Pressable
        style={({ pressed }) => [styles.profilePillPressable, pressed && styles.profilePillPressed]}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ selected: active }}
        onPress={onPress}
      >
        <IconComponent size={18} color={active ? color.color : fadedColor} weight="duotone" />
        <AnimatedText
          style={[
            styles.profilePillText,
            { color: active ? color.color : theme.palette.slate.textMuted },
            labelStyle,
          ]}
          numberOfLines={1}
        >
          {label}
        </AnimatedText>
      </Pressable>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  profilePill: {
    width: PROFILE_OPTION_WIDTH,
    height: PROFILE_OPTION_WIDTH,
    borderRadius: PROFILE_OPTION_WIDTH / 2,
    borderWidth: 1,
    overflow: 'hidden',
  },
  profilePillPressable: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  profilePillPressed: {
    backgroundColor: theme.palette.slate.surface,
  },
  profilePillText: {
    color: theme.palette.slate.textMuted,
    fontSize: 12,
    fontWeight: '700',
  },
})
