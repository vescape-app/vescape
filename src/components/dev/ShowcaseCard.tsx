import { StyleSheet, View } from 'react-native'
import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'

interface ShowcaseCardProps {
  name: string
  children: React.ReactNode
  controls?: React.ReactNode
}

export function ShowcaseCard({ name, children, controls }: ShowcaseCardProps) {
  return (
    <View style={styles.card}>
      <Text style={styles.name}>{name}</Text>
      <View style={styles.preview}>{children}</View>
      {controls ? <View style={styles.controls}>{controls}</View> : null}
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
  name: {
    color: theme.palette.sky.color,
    fontSize: 12,
    fontWeight: '800',
    fontFamily: 'monospace',
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 6,
  },
  preview: {
    paddingHorizontal: 14,
    paddingBottom: 10,
  },
  controls: {
    borderTopWidth: 1,
    borderTopColor: theme.neutral.border,
    paddingHorizontal: 14,
    paddingVertical: 8,
    gap: 6,
  },
})
