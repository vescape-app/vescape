import type { Icon } from 'phosphor-react-native'
import type { ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'

import { Text } from '@/components/base/Text'
import { theme, type ThemeColor } from '@/constants/theme'

interface SectionHeaderProps {
  icon: Icon
  title: string
  color?: ThemeColor
  description?: string
  right?: ReactNode
  align?: 'left' | 'center'
}

export function SectionHeader({
  icon: HeaderIcon,
  title,
  color = theme.neutral.textSecondary,
  description,
  right,
  align = 'left',
}: SectionHeaderProps) {
  const centered = align === 'center'
  return (
    <View style={[styles.container, centered && styles.containerCentered]}>
      <View style={[styles.row, centered && styles.rowCentered]}>
        <HeaderIcon size={20} color={color} weight="duotone" />
        <Text style={styles.title}>{title}</Text>
        {right ? <View style={styles.right}>{right}</View> : null}
      </View>
      {description ? (
        <Text style={[styles.description, centered && styles.descriptionCentered]}>
          {description}
        </Text>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    gap: 4,
  },
  containerCentered: {
    alignSelf: 'stretch',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  rowCentered: {
    justifyContent: 'center',
  },
  title: {
    color: theme.neutral.textPrimary,
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  right: {
    marginLeft: 'auto',
  },
  description: {
    color: theme.neutral.textSecondary,
    fontSize: 11,
    letterSpacing: 0.3,
  },
  descriptionCentered: {
    textAlign: 'center',
  },
})
