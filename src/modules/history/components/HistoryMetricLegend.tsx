import { StyleSheet, View } from 'react-native'

import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'

export function HistoryMetricLegend() {
  return (
    <View style={styles.metricLegend}>
      <View style={styles.metricLegendItem}>
        <View style={[styles.metricLegendLine, { backgroundColor: theme.neutral.textSecondary }]} />
        <Text style={styles.metricLegendText} numberOfLines={1}>
          Low speed
        </Text>
      </View>
      <View style={styles.metricLegendItem}>
        <View style={[styles.metricLegendLine, { backgroundColor: theme.palette.yellow.color }]} />
        <Text style={styles.metricLegendText} numberOfLines={1}>
          Free spin
        </Text>
      </View>
      <View style={styles.metricLegendItem}>
        <View style={[styles.metricLegendLine, { backgroundColor: theme.palette.red.color }]} />
        <Text style={styles.metricLegendText} numberOfLines={1}>
          No GPS
        </Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  metricLegend: {
    marginTop: 2,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    columnGap: 8,
    rowGap: 3,
    paddingHorizontal: 6,
  },
  metricLegendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    maxWidth: '48%',
  },
  metricLegendLine: {
    width: 6,
    height: 1,
    borderRadius: 0.5,
  },
  metricLegendText: {
    color: theme.neutral.textMuted,
    fontSize: 8,
    fontWeight: '600',
  },
})
