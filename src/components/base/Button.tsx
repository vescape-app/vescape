import type { Icon } from 'phosphor-react-native'
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
} from 'react-native'
import { Text } from '@/components/base/Text'
import { useColoredAction } from '@/hooks/useTheme'

import { interaction, theme } from '@/constants/theme'

interface ButtonProps {
  label: string
  onPress: () => Promise<void> | void
  testID?: string
  accessibilityLabel?: string
  variant?: 'primary' | 'accent' | 'tune' | 'secondary' | 'success' | 'destructive'
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
  variant = 'primary',
  size = 'md',
  icon: IconComponent,
  iconPosition = 'left',
  loading = false,
  disabled = false,
  style,
}: ButtonProps) {
  const isDisabled = disabled || loading
  const coloredAction = useColoredAction(accentColors[variant].border)
  const icon =
    IconComponent && !loading ? (
      <IconComponent
        size={size === 'sm' ? 13 : size === 'lg' ? 17 : 15}
        color={accentColors[variant].icon}
        weight="bold"
      />
    ) : null

  return (
    <Pressable
      style={({ pressed }) => [
        styles.base,
        size === 'sm' ? styles.sm : size === 'lg' ? styles.lg : styles.md,
        accentColors[variant].button(coloredAction),
        isDisabled && styles.disabled,
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
        <ActivityIndicator size="small" color={accentColors[variant].indicator} />
      ) : iconPosition === 'left' ? (
        icon
      ) : null}
      <Text
        numberOfLines={1}
        style={[
          styles.label,
          size === 'sm' ? styles.labelSm : size === 'lg' ? styles.labelLg : styles.labelMd,
          accentColors[variant].text,
        ]}
      >
        {label}
      </Text>
      {!loading && iconPosition === 'right' ? icon : null}
    </Pressable>
  )
}

const accentColors = {
  primary: {
    border: theme.control.border,
    icon: theme.control.icon,
    indicator: theme.control.icon,
    button: () => ({
      backgroundColor: theme.control.background,
      borderWidth: 1,
      borderColor: theme.control.border,
    }),
    text: { color: theme.control.text },
  },
  accent: {
    border: theme.palette.cyan.color,
    icon: theme.palette.cyan.light,
    indicator: theme.palette.cyan.light,
    button: (background: string) => ({
      backgroundColor: background,
      borderWidth: 1,
      borderColor: theme.palette.cyan.color,
    }),
    text: { color: theme.palette.cyan.light },
  },
  tune: {
    border: theme.tune.color,
    icon: theme.tune.light,
    indicator: theme.tune.light,
    button: (background: string) => ({
      backgroundColor: background,
      borderWidth: 1,
      borderColor: theme.tune.color,
    }),
    text: { color: theme.tune.light },
  },
  secondary: {
    border: theme.control.border,
    icon: theme.control.textMuted,
    indicator: theme.control.textMuted,
    button: () => ({
      backgroundColor: theme.control.background,
      borderWidth: 1,
      borderColor: theme.control.border,
    }),
    text: { color: theme.control.textMuted },
  },
  success: {
    border: theme.palette.green.color,
    icon: theme.palette.green.light,
    indicator: theme.palette.green.light,
    button: (background: string) => ({
      backgroundColor: background,
      borderWidth: 1,
      borderColor: theme.palette.green.color,
    }),
    text: { color: theme.palette.green.light },
  },
  destructive: {
    border: theme.palette.red.color,
    icon: theme.palette.red.light,
    indicator: theme.palette.red.light,
    button: (background: string) => ({
      backgroundColor: background,
      borderWidth: 1,
      borderColor: theme.palette.red.color,
    }),
    text: { color: theme.palette.red.light },
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
  disabled: {
    opacity: 0.4,
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
