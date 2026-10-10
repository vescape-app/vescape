import { StyleSheet } from 'react-native'
import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'

export interface SettingsSectionTitleProps {
  children: string
}

export function SettingsSectionTitle({ children }: SettingsSectionTitleProps) {
  return <Text style={styles.title}>{children}</Text>
}

const styles = StyleSheet.create({
  title: {
    color: theme.neutral.textMuted,
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 8,
    marginBottom: 4,
    marginLeft: 4,
  },
})
