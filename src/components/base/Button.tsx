import type { Icon } from 'phosphor-react-native'
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
} from 'react-native'
import { Text } from '@/components/base/Text'

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
  const icon =
    IconComponent && !loading ? (
      <IconComponent
        size={size === 'sm' ? 13 : size === 'lg' ? 17 : 15}
        color={variantStyles[variant].iconColor}
        weight="bold"
      />
    ) : null

  return (
    <Pressable
      style={({ pressed }) => [
        styles.base,
        size === 'sm' ? styles.sm : size === 'lg' ? styles.lg : styles.md,
        variantStyles[variant].button,
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
        <ActivityIndicator size="small" color={variantStyles[variant].indicatorColor} />
      ) : iconPosition === 'left' ? (
        icon
      ) : null}
      <Text
        style={[
          styles.label,
          size === 'sm' ? styles.labelSm : size === 'lg' ? styles.labelLg : styles.labelMd,
          variantStyles[variant].text,
        ]}
      >
        {label}
      </Text>
      {!loading && iconPosition === 'right' ? icon : null}
    </Pressable>
  )
}

const variantStyles = {
  primary: {
    button: { backgroundColor: theme.palette.cyan.border },
    text: { color: theme.palette.slate.textPrimary },
    iconColor: theme.palette.slate.textPrimary,
    indicatorColor: theme.palette.slate.textPrimary,
  },
  accent: {
    button: {
      backgroundColor: theme.palette.slate.surface,
      borderWidth: 1,
      borderColor: theme.palette.cyan.border,
    },
    text: { color: theme.palette.cyan.text },
    iconColor: theme.palette.cyan.text,
    indicatorColor: theme.palette.cyan.text,
  },
  tune: {
    button: { backgroundColor: theme.tune.border },
    text: { color: theme.palette.slate.textPrimary },
    iconColor: theme.palette.slate.textPrimary,
    indicatorColor: theme.palette.slate.textPrimary,
  },
  secondary: {
    button: {
      backgroundColor: theme.palette.slate.surface,
      borderWidth: 1,
      borderColor: theme.palette.slate.border,
    },
    text: { color: theme.palette.slate.textSecondary },
    iconColor: theme.palette.slate.textSecondary,
    indicatorColor: theme.palette.slate.textSecondary,
  },
  success: {
    button: {
      backgroundColor: theme.status.success.bg,
      borderWidth: 1,
      borderColor: theme.status.success.border,
    },
    text: { color: theme.status.success.text },
    iconColor: theme.status.success.text,
    indicatorColor: theme.status.success.text,
  },
  destructive: {
    button: {
      backgroundColor: theme.status.error.bg,
      borderWidth: 1,
      borderColor: theme.status.error.border,
    },
    text: { color: theme.status.error.text },
    iconColor: theme.status.error.text,
    indicatorColor: theme.status.error.text,
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
