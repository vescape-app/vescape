import type { Icon } from 'phosphor-react-native'
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
} from 'react-native'
import { Text } from '@/components/base/Text'
import { useColoredAction, useColoredActionForeground } from '@/hooks/useTheme'

import { interaction, theme, type ThemeColor } from '@/constants/theme'

interface ButtonProps {
  label: string
  onPress: () => Promise<void> | void
  testID?: string
  accessibilityLabel?: string
  /** Overrides the variant's accent for field-specific actions. */
  accent?: ThemeColor
  variant?:
    | 'primary'
    | 'accent'
    | 'tune'
    | 'secondary'
    | 'success'
    | 'caution'
    | 'destructive'
    | 'groupRide'
  size?: 'sm' | 'md' | 'lg'
  icon?: Icon
  iconPosition?: 'left' | 'right'
  loading?: boolean
  disabled?: boolean
  style?: StyleProp<ViewStyle>
}

export function Button({
  label,
  onPress,
  testID,
  accessibilityLabel,
  accent,
  variant = 'primary',
  size = 'md',
  icon: IconComponent,
  iconPosition = 'left',
  loading = false,
  disabled = false,
  style,
}: ButtonProps) {
  const isDisabled = disabled || loading
  const variantColors = accentColors[variant]
  const isColored = accent !== undefined || variantColors.colored
  const accentToken = accent ?? variantColors.border
  const coloredAction = useColoredAction(accentToken)
  const coloredBorder = useColoredActionForeground(accentToken)
  const coloredForeground = useColoredActionForeground(accent ?? variantColors.foreground)
  // A disabled button drops its accent entirely: dimming the accent pill with opacity washes it out
  // against a light background until the label is unreadable.
  const button = isDisabled
    ? {
        backgroundColor: theme.control.backgroundDisabled,
        borderWidth: 1,
        borderColor: theme.control.border,
      }
    : isColored
      ? { backgroundColor: coloredAction, borderWidth: 1, borderColor: coloredBorder }
      : {
          backgroundColor: theme.control.background,
          borderWidth: 1,
          borderColor: variantColors.border,
        }
  const foreground = isDisabled
    ? theme.control.textMuted
    : isColored
      ? coloredForeground
      : variantColors.foreground
  const icon =
    IconComponent && !loading ? (
      <IconComponent
        size={size === 'sm' ? 13 : size === 'lg' ? 17 : 15}
        color={foreground}
        weight="bold"
      />
    ) : null

  return (
    <Pressable
      style={({ pressed }) => [
        styles.base,
        size === 'sm' ? styles.sm : size === 'lg' ? styles.lg : styles.md,
        button,
        pressed && !isDisabled && { opacity: interaction.pressedOpacity },
        style,
      ]}
      android_ripple={interaction.ripple}
      onPress={() => void onPress()}
      disabled={isDisabled}
      testID={testID}
      accessibilityLabel={accessibilityLabel ?? label}
    >
      {loading ? (
        <ActivityIndicator size="small" color={foreground} />
      ) : iconPosition === 'left' ? (
        icon
      ) : null}
      <Text
        numberOfLines={1}
        style={[
          styles.label,
          size === 'sm' ? styles.labelSm : size === 'lg' ? styles.labelLg : styles.labelMd,
          {
            color: isDisabled
              ? theme.control.textMuted
              : isColored
                ? coloredForeground
                : variantColors.text,
          },
        ]}
      >
        {label}
      </Text>
      {!loading && iconPosition === 'right' ? icon : null}
    </Pressable>
  )
}

/**
 * `foreground` is the label/icon/indicator token. Colored variants sit on the navy colored-action
 * surface, so their foreground is resolved through `useColoredActionForeground`.
 */
const accentColors = {
  primary: {
    colored: false,
    border: theme.control.border,
    foreground: theme.control.icon,
    text: theme.control.text,
  },
  accent: {
    colored: true,
    border: theme.palette.cyan.color,
    foreground: theme.palette.cyan.light,
    text: theme.palette.cyan.light,
  },
  tune: {
    colored: true,
    border: theme.tune.color,
    foreground: theme.tune.light,
    text: theme.tune.light,
  },
  secondary: {
    colored: false,
    border: theme.control.border,
    foreground: theme.control.textMuted,
    text: theme.control.textMuted,
  },
  success: {
    colored: true,
    border: theme.palette.green.color,
    foreground: theme.palette.green.light,
    text: theme.palette.green.light,
  },
  caution: {
    colored: true,
    border: theme.status.caution.border,
    foreground: theme.status.caution.text,
    text: theme.status.caution.text,
  },
  destructive: {
    colored: true,
    border: theme.palette.red.color,
    foreground: theme.palette.red.light,
    text: theme.palette.red.light,
  },
  groupRide: {
    colored: true,
    border: theme.palette.groupRide.color,
    foreground: theme.palette.groupRide.light,
    text: theme.palette.groupRide.light,
  },
} as const

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    gap: 6,
    overflow: 'hidden',
  },
  md: {
    height: 40,
    paddingHorizontal: 16,
  },
  lg: {
    height: 48,
    paddingHorizontal: 20,
  },
  sm: {
    height: 32,
    paddingHorizontal: 12,
  },
  label: {
    fontWeight: '700',
    flexShrink: 1,
  },
  labelMd: {
    fontSize: 13,
  },
  labelLg: {
    fontSize: 14,
  },
  labelSm: {
    fontSize: 12,
  },
})
