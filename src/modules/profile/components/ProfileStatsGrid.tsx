import { StyleSheet, View } from 'react-native'

import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'
import type { ProfileStatItem } from '@/modules/profile/components/profileStatItems'

interface ProfileStatsGridProps {
  items: ProfileStatItem[]
  /** Larger figures for the two-column summary in the History drawer. */
  emphasis?: boolean
  testID?: string
}

/** Riding totals laid out two per row: icon, figure, label. */
export function ProfileStatsGrid({ items, emphasis = false, testID }: ProfileStatsGridProps) {
  return (
    <View style={styles.grid} testID={testID}>
      {items.map((item) => {
        const ItemIcon = item.icon
        return (
          <View key={item.key} style={[styles.cell, emphasis && styles.cellEmphasis]}>
            <ItemIcon size={emphasis ? 16 : 18} color={item.accent} weight="duotone" />
            <Text style={[styles.value, emphasis && styles.valueEmphasis]}>{item.value}</Text>
            <Text style={styles.label}>{item.label}</Text>
          </View>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  cell: {
    width: '50%',
    paddingVertical: 10,
    paddingHorizontal: 6,
  },
  cellEmphasis: {
    paddingVertical: 6,
  },
  value: {
    color: theme.palette.slate.textPrimary,
    fontSize: 18,
    fontWeight: '700',
    marginTop: 4,
  },
  valueEmphasis: {
    fontSize: 20,
    marginTop: 2,
  },
  label: {
    color: theme.palette.slate.textMuted,
    fontSize: 11,
    fontWeight: '600',
  },
})
