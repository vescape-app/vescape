import type { Icon } from 'phosphor-react-native'
import type { ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'

import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'

interface SectionHeaderProps {
  icon: Icon
  title: string
  /** Tint of the icon; sections are told apart by it. */
  color?: string
  /** One line under the title saying what the section is for. */
  description?: string
  /** Action belonging to the section, pinned to the right of the title row. */
  right?: ReactNode
}

/**
 * Heading of a section inside a screen: icon, title, an optional line of detail, and an optional
 * action. One component so every section on every screen reads at the same weight — a screen that
 * invents its own heading is a screen that drifts out of the set.
 */
export function SectionHeader({
  icon: HeaderIcon,
  title,
  color = theme.palette.slate.textSecondary,
  description,
  right,
}: SectionHeaderProps) {
  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <HeaderIcon size={20} color={color} weight="duotone" />
        <Text style={styles.title}>{title}</Text>
        <View style={styles.right}>{right}</View>
      </View>
      {description ? <Text style={styles.description}>{description}</Text> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    // The description is part of the heading, but it is not the title's second line.
    gap: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    color: theme.palette.slate.textPrimary,
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  right: {
    marginLeft: 'auto',
  },
  description: {
    color: theme.palette.slate.textSecondary,
    fontSize: 11,
    letterSpacing: 0.3,
  },
})
