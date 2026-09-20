import type { ReactNode } from 'react'
import { StyleSheet, View, type ViewStyle } from 'react-native'
import { Text } from '@/components/base/Text'
import type { Icon } from 'phosphor-react-native'
import { theme, type ThemeColor } from '@/constants/theme'

interface PlaceholderProps {
  icon: Icon
  title?: string
  description: string
  iconColor?: ThemeColor
  action?: ReactNode
  /** Sized for an empty section inside a list or drawer rather than a whole empty screen. */
  compact?: boolean
  style?: ViewStyle
}

export function Placeholder({
  icon: IconComponent,
  title,
  description,
  iconColor = theme.neutral.textMuted,
  action,
  compact = false,
  style,
}: PlaceholderProps) {
  return (
    <View style={[styles.container, compact && styles.containerCompact, style]}>
      <IconComponent size={compact ? 40 : 58} color={iconColor} weight="thin" />
      <View style={styles.textBlock}>
        {title ? <Text style={styles.title}>{title}</Text> : null}
        <Text style={styles.description}>{description}</Text>
      </View>
      {action}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 36,
    gap: 18,
  },
  containerCompact: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    gap: 12,
  },
  textBlock: {
    alignItems: 'center',
    gap: 6,
  },
  title: {
    color: theme.neutral.textPrimary,
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
  description: {
    color: theme.neutral.textMuted,
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
  },
})
