import { StyleSheet, View } from 'react-native'

import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'
import type { ProfileStatItem } from '@/modules/profile/hooks/useProfileStatItems'

interface ProfileStatsGridProps {
  items: ProfileStatItem[]
  /** Larger figures for the summary in the History drawer. */
  emphasis?: boolean
  columns?: 2 | 3 | 4
  testID?: string
}

/** Riding totals laid out as icon, figure, label. */
export function ProfileStatsGrid({
  items,
  emphasis = false,
  columns = 2,
  testID,
}: ProfileStatsGridProps) {
  return (
    <View style={styles.grid} testID={testID}>
      {items.map((item) => {
        const ItemIcon = item.icon
        return (
          <View
            key={item.key}
            style={[
              styles.cell,
              columns === 3 && styles.cellThird,
              columns === 4 && styles.cellFourth,
              emphasis && styles.cellEmphasis,
            ]}
          >
            <ItemIcon
              size={columns === 4 ? 14 : emphasis ? 16 : 18}
              color={item.accent}
              weight="duotone"
            />
            <Text
              style={[
                styles.value,
                emphasis && styles.valueEmphasis,
                columns === 3 && styles.valueThird,
                columns === 4 && styles.valueFourth,
              ]}
              numberOfLines={columns > 2 ? 1 : undefined}
              adjustsFontSizeToFit={columns > 2}
              minimumFontScale={0.75}
            >
              {item.value}
            </Text>
            <Text
              style={[styles.label, columns === 4 && styles.labelFourth]}
              numberOfLines={columns > 2 ? 1 : undefined}
            >
              {item.label}
            </Text>
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
    minWidth: 0,
    paddingVertical: 10,
    paddingHorizontal: 6,
  },
  cellThird: {
    width: '33.333%',
  },
  cellFourth: {
    width: '25%',
    paddingHorizontal: 3,
  },
  cellEmphasis: {
    paddingVertical: 6,
  },
  value: {
    color: theme.neutral.textPrimary,
    fontSize: 18,
    fontWeight: '700',
    marginTop: 4,
  },
  valueEmphasis: {
    fontSize: 20,
    marginTop: 2,
  },
  valueThird: {
    fontSize: 17,
  },
  valueFourth: {
    fontSize: 15,
  },
  label: {
    color: theme.neutral.textMuted,
    fontSize: 11,
    fontWeight: '600',
  },
  labelFourth: {
    fontSize: 10,
  },
})
