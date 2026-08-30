import { StyleSheet, View } from 'react-native'
import type { Icon } from 'phosphor-react-native'

import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'

export interface WidgetHeaderProps {
  icon: Icon
  title: string
  description?: string
  accent?: string
}

/** Icon + title + description row shared by a widget's collapsed card and its focused panel. */
export function WidgetHeader({
  icon: IconComponent,
  title,
  description,
  accent = theme.control.textMuted,
}: WidgetHeaderProps) {
  return (
    <View style={styles.titleRow}>
      <IconComponent size={22} color={accent} weight="duotone" />
      <View style={styles.textColumn}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        {description ? (
          <Text style={styles.description} numberOfLines={2}>
            {description}
          </Text>
        ) : null}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  titleRow: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  textColumn: {
    flex: 1,
    minWidth: 0,
    gap: 6,
  },
  title: {
    color: theme.neutral.textPrimary,
    fontSize: 15,
    fontWeight: '800',
  },
  description: {
    color: theme.neutral.textSecondary,
    fontSize: 12,
    lineHeight: 16,
  },
})
