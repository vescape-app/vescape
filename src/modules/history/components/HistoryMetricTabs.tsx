import { Pressable, StyleSheet, View } from 'react-native'

import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'
import { temperatureSymbol } from '@/helpers/units'
import { useUserPreferences } from '@/hooks/useUserPreferences'
import {
  OPTIONAL_CHART_METRICS,
  type ChartTabMetricDef,
  type ChartToggleMetric,
} from '@/modules/history/components/historyChartMetrics'

interface HistoryMetricTabsProps {
  activeCharts: ReadonlySet<ChartToggleMetric>
  onToggle: (metric: ChartToggleMetric) => void
  metrics?: readonly ChartTabMetricDef[]
  columns?: number
}

export function HistoryMetricTabs({
  activeCharts,
  onToggle,
  metrics = OPTIONAL_CHART_METRICS,
  columns,
}: HistoryMetricTabsProps) {
  const { temperatureUnit } = useUserPreferences()
  const tempUnit = temperatureSymbol(temperatureUnit)
  const perRow = columns ?? metrics.length
  const wrapped = perRow < metrics.length
  return (
    <View style={[styles.metricTabs, wrapped && styles.metricTabsWrapped]}>
      {metrics.map((metric, index) => {
        const active = activeCharts.has(metric.key)
        const lastInRow = index % perRow === perRow - 1
        const firstRow = index < perRow
        const tabLabel =
          metric.key === 'tempMotor'
            ? `Motor ${tempUnit}`
            : metric.key === 'tempController'
              ? `Ctrl ${tempUnit}`
              : metric.tabLabel
        return (
          <Pressable
            key={metric.key}
            testID={`history-metric-tab-${metric.key}`}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            style={[
              styles.metricTab,
              wrapped ? { width: `${100 / perRow}%` } : styles.metricTabFlex,
              !lastInRow && index < metrics.length - 1 && styles.metricTabDivider,
              !firstRow && styles.metricTabRowDivider,
              active && styles.metricTabActive,
            ]}
            onPress={() => onToggle(metric.key)}
          >
            <View
              style={[
                styles.metricTabLine,
                { backgroundColor: active ? metric.color : theme.control.textMuted },
              ]}
            />
            {tabLabel ? (
              <Text
                style={[styles.metricTabText, active && styles.metricTabTextActive]}
                numberOfLines={1}
                ellipsizeMode="tail"
              >
                {tabLabel}
              </Text>
            ) : metric.multilineLabel ? (
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
    borderColor: theme.control.border,
    backgroundColor: theme.control.background,
    overflow: 'hidden',
  },
  metricTabsWrapped: {
    borderRadius: 14,
  },
  metricTabFlex: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
  },
  metricTab: {
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.control.background,
    paddingHorizontal: 8,
    paddingTop: 10,
    paddingBottom: 10,
  },
  metricTabDivider: {
    borderRightWidth: 1,
    borderRightColor: theme.control.divider,
  },
  metricTabRowDivider: {
    borderTopWidth: 1,
    borderTopColor: theme.control.divider,
  },
  metricTabActive: {
    backgroundColor: theme.neutral.surface,
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
    color: theme.control.textMuted,
    fontSize: 10,
    fontWeight: '700',
    width: '100%',
    textAlign: 'center',
    lineHeight: 12,
  },
  metricTabTextActive: {
    color: theme.neutral.textPrimary,
  },
})
