import type { ReactNode } from 'react'
import { StyleSheet, View, type ViewStyle } from 'react-native'
import { Text } from '@/components/base/Text'
import type { Icon } from 'phosphor-react-native'
import { theme } from '@/constants/theme'

interface PlaceholderProps {
  icon: Icon
  title?: string
  description: string
  action?: ReactNode
  style?: ViewStyle
}

export function Placeholder({
  icon: IconComponent,
  title,
  description,
  action,
  style,
}: PlaceholderProps) {
  return (
    <View style={[styles.container, style]}>
      <IconComponent size={58} color={theme.palette.slate.textMuted} weight="thin" />
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
  textBlock: {
    alignItems: 'center',
    gap: 6,
  },
  title: {
    color: theme.palette.slate.textPrimary,
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
  description: {
    color: theme.palette.slate.textMuted,
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
  },
})
