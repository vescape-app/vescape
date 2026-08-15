import { type ReactNode } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { Text } from '@/components/base/Text'
import { CaretRightIcon } from 'phosphor-react-native'
import type { Icon, IconWeight } from 'phosphor-react-native'
import { theme } from '@/constants/theme'

export type SettingsRowProps = {
  icon: Icon
  iconColor?: string
  iconWeight?: IconWeight
  label: string
  hint?: string
  onPress?: () => void
  right?: ReactNode
  children?: ReactNode
}

export function SettingsRow({
  icon: IconComponent,
  iconColor = theme.neutral.textSecondary,
  iconWeight = 'duotone',
  label,
  hint,
  onPress,
  right,
  children,
}: SettingsRowProps) {
  const showChevron = onPress && !right

  const content = (
    <View style={styles.row}>
      <View style={styles.icon}>
        <IconComponent size={20} color={iconColor} weight={iconWeight} />
      </View>
      <View style={styles.body}>
        <Text style={styles.label}>{label}</Text>
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      </View>
      {right}
      {showChevron ? (
        <CaretRightIcon size={18} color={theme.neutral.textMuted} weight="bold" />
      ) : null}
    </View>
  )

  if (onPress) {
    return (
      <Pressable
        style={({ pressed }) => [styles.container, pressed && styles.containerPressed]}
        onPress={onPress}
      >
        {content}
        {children}
      </Pressable>
    )
  }

  return (
    <View style={styles.container}>
      {content}
      {children}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  containerPressed: {
    backgroundColor: theme.neutral.surface,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 12,
  },
  icon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: theme.neutral.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flex: 1,
    gap: 2,
  },
  label: {
    color: theme.neutral.textPrimary,
    fontSize: 15,
    fontWeight: '600',
  },
  hint: {
    color: theme.neutral.textMuted,
    fontSize: 12,
    fontWeight: '500',
  },
})
