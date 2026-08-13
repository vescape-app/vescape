import { Pressable, StyleSheet, View } from 'react-native'

import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'
import {
  OPTIONAL_CHART_METRICS,
  type ChartTabMetricDef,
  type ChartToggleMetric,
} from '@/modules/history/components/historyChartMetrics'

interface HistoryMetricTabsProps {
  activeCharts: ReadonlySet<ChartToggleMetric>
  onToggle: (metric: ChartToggleMetric) => void
  /** Which metrics to offer. Defaults to the map-colourable ones the ride panel shows. */
  metrics?: readonly ChartTabMetricDef[]
  /** Tabs per row; the rest wrap onto the next one. Defaults to a single row. */
  columns?: number
}

export function HistoryMetricTabs({
  activeCharts,
  onToggle,
  metrics = OPTIONAL_CHART_METRICS,
  columns,
}: HistoryMetricTabsProps) {
  const perRow = columns ?? metrics.length
  // A single row reads as a pill; once tabs wrap, that radius cuts into the corner labels, so a
  // multi-row group is a card instead.
  const wrapped = perRow < metrics.length
  return (
    <View style={[styles.metricTabs, wrapped && styles.metricTabsWrapped]}>
      {metrics.map((metric, index) => {
        const active = activeCharts.has(metric.key)
        const lastInRow = index % perRow === perRow - 1
        const firstRow = index < perRow
        return (
          <Pressable
            key={metric.key}
            testID={`history-metric-tab-${metric.key}`}
            style={[
              styles.metricTab,
              { width: `${100 / perRow}%` },
              !lastInRow && index < metrics.length - 1 && styles.metricTabDivider,
              !firstRow && styles.metricTabRowDivider,
              active && styles.metricTabActive,
            ]}
            onPress={() => onToggle(metric.key)}
          >
            <View
              style={[
                styles.metricTabLine,
                { backgroundColor: active ? metric.color : theme.palette.slate.surface },
              ]}
            />
            {metric.multilineLabel ? (
              <View style={styles.metricTabTextStack}>
                <Text
                  style={[styles.metricTabText, active && styles.metricTabTextActive]}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                >
                  {metric.multilineLabel[0]}
                </Text>
                <Text
                  style={[styles.metricTabText, active && styles.metricTabTextActive]}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                >
                  {metric.multilineLabel[1]}
                </Text>
              </View>
            ) : (
              <Text
                style={[styles.metricTabText, active && styles.metricTabTextActive]}
                numberOfLines={1}
                ellipsizeMode="tail"
              >
                {metric.label}
              </Text>
            )}
          </Pressable>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  metricTabs: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.palette.slate.border,
    backgroundColor: theme.palette.slate.surfaceDeep,
    overflow: 'hidden',
  },
  metricTabsWrapped: {
    borderRadius: 14,
  },
  metricTab: {
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.palette.slate.surfaceDeep,
    paddingHorizontal: 8,
    paddingTop: 10,
    paddingBottom: 10,
  },
  metricTabDivider: {
    borderRightWidth: 1,
    borderRightColor: theme.palette.slate.border,
  },
  metricTabRowDivider: {
    borderTopWidth: 1,
    borderTopColor: theme.palette.slate.border,
  },
  metricTabActive: {
    backgroundColor: theme.palette.sky.bg,
  },
  metricTabLine: {
    width: '60%',
    height: 3,
    borderRadius: 2,
    marginBottom: 6,
  },
  metricTabTextStack: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1,
  },
  metricTabText: {
    color: theme.palette.slate.textSecondary,
    fontSize: 10,
    fontWeight: '700',
    width: '100%',
    textAlign: 'center',
    lineHeight: 12,
  },
  metricTabTextActive: {
    color: theme.palette.sky.text,
  },
})
