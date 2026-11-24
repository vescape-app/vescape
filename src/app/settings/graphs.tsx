import type { ReactNode } from 'react'
import { PageScrollView } from '@/components/base/PageScrollView'
import { useFocusTarget } from '@/components/base/focusScroll'
import { useResolvedNeutralColors } from '@/hooks/useTheme'
import { useUserPreferences } from '@/hooks/useUserPreferences'
import {
  speedFromKmh,
  speedInputToKmh,
  speedUnit,
  temperatureFromC,
  temperatureInputToC,
  temperatureSymbol,
} from '@/helpers/units'
import { stepDelta } from '@/helpers/numberStep'
import { View, StyleSheet } from 'react-native'
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
import { Switch } from '@/components/controls/Switch'
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

function HotRangeRow({ focusId, children }: { focusId: string; children: ReactNode }) {
  const neutral = useResolvedNeutralColors()
  const { targetRef, onLayout, highlighted } = useFocusTarget(focusId)
  return (
    <View
      ref={targetRef}
      onLayout={onLayout}
      collapsable={false}
      style={[styles.hotRangeRow, highlighted && { backgroundColor: neutral.surface }]}
    >
      {children}
    </View>
  )
}

export default function GraphsSettingsScreen() {
  const { distanceUnit, temperatureUnit } = useUserPreferences()
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
    <SafeAreaView style={styles.container} edges={[]}>
      <PageScrollView contentContainerStyle={styles.content}>
        <IconHero
          icon={ChartLineUpIcon}
          description="Hot graph ramps start at Start and reach full warning color at End."
        />
        <SettingsCard>
          <SettingsRow
            focusId="graph-hot-gradients"
            icon={GaugeIcon}
            iconColor={theme.status.warning.color}
            label="Graph hot gradients"
            hint="Color live, history, and map graphs by metric value"
            right={
              <Switch
                value={historyMetricGradientsEnabled}
                onValueChange={(v) => void set('historyMetricGradientsEnabled', v)}
              />
            }
          />
          {HOT_RANGE_METRICS.map((metric) => {
            const fallback = DEFAULT_HISTORY_METRIC_HOT_RANGES[metric.key] ?? { start: 0, end: 1 }
            const range = historyMetricHotRanges[metric.key] ?? fallback

            const isSpeed = metric.key === 'speed'
            const isTemp = metric.key === 'tempMotor' || metric.key === 'tempController'
            const display = (value: number) =>
              isSpeed
                ? speedFromKmh(value, distanceUnit)
                : isTemp
                  ? temperatureFromC(value, temperatureUnit)
                  : value
            const unit = isSpeed
              ? speedUnit(distanceUnit)
              : isTemp
                ? temperatureSymbol(temperatureUnit)
                : metric.unit
            const formatValue = (value: number) => String(Number(value.toFixed(1)))
            const toCanonical = (nextValue: number, current: number) =>
              isSpeed
                ? speedInputToKmh(nextValue, current, distanceUnit, metric.min, metric.max)
                : isTemp
                  ? temperatureInputToC(nextValue, current, temperatureUnit, metric.min, metric.max)
                  : Math.min(metric.max, Math.max(metric.min, nextValue))

            return (
              <HotRangeRow key={metric.key} focusId={`hot-range-${metric.key}`}>
                <View style={styles.hotRangeBody}>
                  <Text style={styles.hotRangeName}>{metric.label}</Text>
                  <Text style={styles.hotRangeHint}>
                    Default: {formatValue(display(fallback.start))}-
                    {formatValue(display(fallback.end))} {unit}
                  </Text>
                </View>
                <View style={styles.hotRangeControl}>
                  <Text style={styles.hotRangeLabel}>Start</Text>
                  <Stepper
                    value={display(range.start)}
                    formatValue={formatValue}
                    step={isSpeed || isTemp ? stepDelta : 1}
                    unit={unit}
                    min={display(metric.min)}
                    max={display(metric.max)}
                    onChange={(nextValue) => {
                      const clampedValue = toCanonical(nextValue, range.start)
                      if (clampedValue !== range.start) {
                        setHotRangeValue(metric.key, 'start', clampedValue)
                      }
                    }}
                  />
                </View>
                <View style={styles.hotRangeControl}>
                  <Text style={styles.hotRangeLabel}>End</Text>
                  <Stepper
                    value={display(range.end)}
                    formatValue={formatValue}
                    step={isSpeed || isTemp ? stepDelta : 1}
                    unit={unit}
                    min={display(metric.min)}
                    max={display(metric.max)}
                    onChange={(nextValue) => {
                      const clampedValue = toCanonical(nextValue, range.end)
                      if (clampedValue !== range.end) {
                        setHotRangeValue(metric.key, 'end', clampedValue)
                      }
                    }}
                  />
                </View>
              </HotRangeRow>
            )
          })}
        </SettingsCard>
      </PageScrollView>
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
