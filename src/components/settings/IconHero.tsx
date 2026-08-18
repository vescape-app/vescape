import { View, StyleSheet } from 'react-native'
import { Text } from '@/components/base/Text'
import type { Icon } from 'phosphor-react-native'
import type { ReactNode } from 'react'

import { theme } from '@/constants/theme'

interface IconHeroProps {
  icon?: Icon
  media?: ReactNode
  title?: string
  description?: string
  children?: ReactNode
  iconSize?: number
  iconColor?: string
  iconWeight?: 'thin' | 'light' | 'regular' | 'bold' | 'fill' | 'duotone'
}

export function IconHero({
  icon: IconComponent,
  media,
  title,
  description,
  children,
  iconSize = 64,
  iconColor = theme.palette.slate.textMuted,
  iconWeight = 'thin',
}: IconHeroProps) {
  return (
    <View style={styles.container}>
      {media ??
        (IconComponent ? (
          <IconComponent size={iconSize} color={iconColor} weight={iconWeight} />
        ) : null)}
      {title ? <Text style={styles.title}>{title}</Text> : null}
      {description ? <Text style={styles.description}>{description}</Text> : null}
      {children}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 32,
    gap: 12,
  },

  title: {
    color: theme.palette.slate.textPrimary,
    fontSize: 28,
    fontWeight: '700',
    textAlign: 'center',
  },
  description: {
    color: theme.palette.slate.textMuted,
    fontSize: 14,
    fontWeight: '500',
    textAlign: 'center',
    lineHeight: 20,
  },
})
