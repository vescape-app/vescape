import { Children, type ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'
import { theme } from '@/constants/theme'

export type SettingsCardProps = {
  children: ReactNode
  /** Separators align with row labels by default; 0 spans them edge to edge. */
  separatorInset?: number
}

export function SettingsCard({ children, separatorInset = 58 }: SettingsCardProps) {
  const items = Children.toArray(children)

  return (
    <View style={styles.card}>
      {items.map((child, index) => (
        <View key={index}>
          {index > 0 ? <View style={[styles.separator, { marginLeft: separatorInset }]} /> : null}
          {child}
        </View>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.neutral.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.neutral.border,
    overflow: 'hidden',
  },
  separator: {
    height: 1,
    backgroundColor: theme.neutral.border,
  },
})
