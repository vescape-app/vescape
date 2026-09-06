import { Children, type ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'
import { useResolvedNeutralColors } from '@/hooks/useTheme'

export interface SettingsCardProps {
  children: ReactNode
  /** Separators align with row labels by default; 0 spans them edge to edge. */
  separatorInset?: number
}

export function SettingsCard({ children, separatorInset = 58 }: SettingsCardProps) {
  const items = Children.toArray(children)
  const neutral = useResolvedNeutralColors()

  return (
    <View
      style={[styles.card, { backgroundColor: neutral.surfaceDeep, borderColor: neutral.border }]}
    >
      {items.map((child, index) => (
        <View key={index}>
          {index > 0 ? (
            <View
              style={[
                styles.separator,
                { marginLeft: separatorInset, backgroundColor: neutral.border },
              ]}
            />
          ) : null}
          {child}
        </View>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
  },
  separator: {
    height: 1,
  },
})
