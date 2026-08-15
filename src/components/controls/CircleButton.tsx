import type { Icon } from 'phosphor-react-native'
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
} from 'react-native'

import { interaction, theme } from '@/constants/theme'

const SIZES = { xs: 32, sm: 38, md: 48, lg: 56 } as const
const ICON_SIZES = { xs: 15, sm: 18, md: 22, lg: 26 } as const

type CircleButtonTone = 'slate' | 'sky' | 'green' | 'amber' | 'red' | 'purple'
type CircleButtonVariant = 'soft' | 'solid' | 'outline' | 'ghost'

interface CircleButtonProps {
  icon: Icon
  onPress: () => Promise<void> | void
  accessibilityLabel: string
  size?: keyof typeof SIZES
  tone?: CircleButtonTone
  variant?: CircleButtonVariant
  disabled?: boolean
  loading?: boolean
  testID?: string
  style?: StyleProp<ViewStyle>
}

const toneTokens = {
  slate: theme.palette.slate,
  sky: theme.palette.sky,
  green: theme.palette.green,
  amber: theme.palette.amber,
  red: theme.palette.red,
  purple: theme.palette.purple,
} as const

export function CircleButton({
  icon: Icon,
  onPress,
  accessibilityLabel,
  size = 'sm',
  tone = 'slate',
  variant = 'soft',
  disabled = false,
  loading = false,
  testID,
  style,
}: CircleButtonProps) {
  const dim = SIZES[size]
  const iconSize = ICON_SIZES[size]
  const colors = getCircleButtonColors(tone, variant)
  const isDisabled = disabled || loading

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      disabled={isDisabled}
      testID={testID}
      android_ripple={interaction.rippleBorderless}
      onPress={() => void onPress()}
      style={({ pressed }) => [
        styles.base,
        {
          width: dim,
          height: dim,
          borderRadius: dim / 2,
          backgroundColor: colors.bg,
          borderColor: colors.border,
        },
        variant !== 'ghost' && styles.bordered,
        isDisabled && styles.disabled,
        pressed && !isDisabled && { opacity: interaction.pressedOpacity },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={colors.icon} />
      ) : (
        <Icon size={iconSize} color={colors.icon} weight="bold" />
      )}
    </Pressable>
  )
}

function getCircleButtonColors(tone: CircleButtonTone, variant: CircleButtonVariant) {
  if (tone === 'slate') {
    if (variant === 'outline' || variant === 'ghost') {
      return {
        bg: theme.alpha(theme.palette.mono.black, 0),
        border: theme.control.border,
        icon: theme.control.icon,
      }
    }
    return {
      bg: theme.control.background,
      border: theme.control.border,
      icon: theme.control.icon,
    }
  }

  const token = toneTokens[tone]
  if (variant === 'solid') {
    return { bg: token.bg, border: token.color, icon: token.text }
  }
  if (variant === 'outline') {
    return { bg: theme.alpha(theme.palette.mono.black, 0), border: token.color, icon: token.text }
  }
  if (variant === 'ghost') {
    return { bg: theme.alpha(theme.palette.mono.black, 0), border: token.border, icon: token.text }
  }
  return { bg: theme.control.background, border: token.color, icon: token.light }
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  bordered: {
    borderWidth: 1,
  },
  disabled: {
    opacity: 0.35,
  },
})
