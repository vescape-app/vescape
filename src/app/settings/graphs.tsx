import { View, Switch, StyleSheet, ScrollView } from 'react-native'
import { Text } from '@/components/base/Text'
import { SafeAreaView } from 'react-native-safe-area-context'
import { GaugeIcon, ChartLineUpIcon } from 'phosphor-react-native'
import { useShallow } from 'zustand/react/shallow'

import { useSettingsStore } from '@/modules/settings/store/settingsStore'
import { theme } from '@/constants/theme'
import {
  DEFAULT_HISTORY_METRIC_HOT_RANGES,
  type HistoryMetricHotRanges,
  type HistoryMetricKey,
} from '@/modules/history/lib/metricColorScale'
import { SettingsCard } from '@/components/settings/SettingsCard'
import { SettingsRow } from '@/components/settings/SettingsRow'
import { Stepper } from '@/components/forms/Stepper'
import { IconHero } from '@/components/settings/IconHero'

const HOT_RANGE_METRICS: {
  key: Exclude<HistoryMetricKey, 'battery'>
  label: string
  unit: string
  min: number
  max: number
}[] = [
  { key: 'speed', label: 'Speed', unit: 'km/h', min: 0, max: 120 },
  { key: 'duty', label: 'Duty', unit: '%', min: 0, max: 100 },
  { key: 'tempMotor', label: 'Motor temp', unit: '°C', min: 0, max: 140 },
  { key: 'tempController', label: 'Controller temp', unit: '°C', min: 0, max: 140 },
  { key: 'motorCurrent', label: 'Motor current', unit: 'A', min: 0, max: 200 },
  { key: 'batteryCurrent', label: 'Battery current', unit: 'A', min: 0, max: 200 },
]

export default function GraphsSettingsScreen() {
  const { historyMetricGradientsEnabled, historyMetricHotRanges, set } = useSettingsStore(
    useShallow((s) => ({
      historyMetricGradientsEnabled: s.historyMetricGradientsEnabled,
      historyMetricHotRanges: s.historyMetricHotRanges,
      set: s.set,
    })),
  )

  const setHotRangeValue = (
    metric: Exclude<HistoryMetricKey, 'battery'>,
    edge: 'start' | 'end',
    value: number,
  ) => {
    const fallback = DEFAULT_HISTORY_METRIC_HOT_RANGES[metric] ?? { start: 0, end: 1 }
    const current = historyMetricHotRanges[metric] ?? fallback
    const nextRanges: HistoryMetricHotRanges = {
      ...historyMetricHotRanges,
      [metric]: { ...current, [edge]: value },
    }
    void set('historyMetricHotRanges', nextRanges)
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <IconHero
          icon={ChartLineUpIcon}
          description="Hot graph ramps start at Start and reach full warning color at End."
        />
        <SettingsCard>
          <SettingsRow
            icon={GaugeIcon}
            label="Graph hot gradients"
            hint="Color live, history, and map graphs by metric value"
            right={
              <Switch
                value={historyMetricGradientsEnabled}
                onValueChange={(v) => void set('historyMetricGradientsEnabled', v)}
                trackColor={{
                  false: theme.neutral.border,
                  true: theme.status.warning.border,
                }}
                thumbColor={
                  historyMetricGradientsEnabled
                    ? theme.status.warning.color
                    : theme.neutral.textMuted
                }
              />
            }
          />
          {HOT_RANGE_METRICS.map((metric) => {
            const fallback = DEFAULT_HISTORY_METRIC_HOT_RANGES[metric.key] ?? { start: 0, end: 1 }
            const range = historyMetricHotRanges[metric.key] ?? fallback

            return (
              <View key={metric.key} style={styles.hotRangeRow}>
                <View style={styles.hotRangeBody}>
                  <Text style={styles.hotRangeName}>{metric.label}</Text>
                  <Text style={styles.hotRangeHint}>
                    Default: {fallback.start}-{fallback.end} {metric.unit}
                  </Text>
                </View>
                <View style={styles.hotRangeControl}>
                  <Text style={styles.hotRangeLabel}>Start</Text>
                  <Stepper
                    value={range.start}
                    unit={metric.unit}
                    min={metric.min}
                    max={metric.max}
                    onChange={(nextValue) => {
                      const clampedValue = Math.min(metric.max, Math.max(metric.min, nextValue))
                      if (clampedValue !== range.start) {
                        setHotRangeValue(metric.key, 'start', clampedValue)
                      }
                    }}
                  />
                </View>
                <View style={styles.hotRangeControl}>
                  <Text style={styles.hotRangeLabel}>End</Text>
                  <Stepper
                    value={range.end}
                    unit={metric.unit}
                    min={metric.min}
                    max={metric.max}
                    onChange={(nextValue) => {
                      const clampedValue = Math.min(metric.max, Math.max(metric.min, nextValue))
                      if (clampedValue !== range.end) {
                        setHotRangeValue(metric.key, 'end', clampedValue)
                      }
                    }}
                  />
                </View>
              </View>
            )
          })}
        </SettingsCard>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.neutral.bg,
  },
  content: {
    padding: 16,
    gap: 8,
  },
  sectionHint: {
    color: theme.neutral.textDim,
    fontSize: 12,
    marginTop: -4,
    marginBottom: 4,
    marginLeft: 4,
  },
  hotRangeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  hotRangeBody: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  hotRangeName: {
    color: theme.neutral.textPrimary,
    fontSize: 15,
    fontWeight: '600',
  },
  hotRangeHint: {
    color: theme.neutral.textMuted,
    fontSize: 12,
  },
  hotRangeControl: {
    width: 96,
    gap: 6,
  },
  hotRangeLabel: {
    color: theme.neutral.textMuted,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
})
