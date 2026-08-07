import { useLayoutEffect, useEffect, useMemo, useCallback } from 'react'
import { useNavigation, useRouter, useFocusEffect } from 'expo-router'
import { BracketsCurlyIcon } from 'phosphor-react-native'
import { useSharedValue } from 'react-native-reanimated'

import { BmsCellVoltages } from '@/modules/battery/components/BmsCellVoltages'
import { ControlDetailLayout } from '@/modules/board/components/ControlDetailLayout'
import { MetricDetailChart } from '@/modules/board/components/MetricDetailChart'
import { toTelemetryChartPoints } from '@/modules/board/components/metricDetailData'
import { IconButton } from '@/components/base/IconButton'
import { computeAutoRange } from '@/components/charts/chartMath'
import { theme } from '@/constants/theme'
import { telemetry } from '@/modules/board/constants/telemetry'
import { useLiveMetric, liveSelectors } from '@/modules/board/hooks/useLiveMetric'
import { deriveBatteryConfig } from '@/modules/battery/lib'
import { useRenderRateWarning } from '@/hooks/useRenderRateWarning'
import { useBoardStore } from '@/modules/board/store/boardStore'
import { acquireBmsSeriesStream, releaseBmsSeriesStream } from '@/modules/board/store/bleStore'
import { routes } from '@/navigation/routes'
import { useLiveWindowMs } from '@/modules/settings/store/settingsStore'
import { useResolvedNeutralColors } from '@/hooks/useTheme'

const battVoltageCfg = telemetry.battVoltage
const battCurrentCfg = telemetry.battCurrent
const battPercentCfg = { ...battVoltageCfg, unit: '%', decimals: 0 }
const formatPercent = (value: number) => `${Math.round(value)}%`
const formatVoltage = battVoltageCfg.formatWithUnit

const PERCENT_RANGE = { y: { min: 0, max: 100 } }

export default function BatteryScreen() {
  const neutral = useResolvedNeutralColors()
  useRenderRateWarning('BatteryScreen')
  const navigation = useNavigation()
  const router = useRouter()
  const batteryPercent = useLiveMetric(liveSelectors.batteryPercent)
  const batteryVoltage = useLiveMetric(liveSelectors.batteryVoltage)
  const batteryCurrent = useLiveMetric(liveSelectors.batteryCurrent)
  const windowMs = useLiveWindowMs()

  // One cursor shared by every chart on this screen — scrubbing any chart moves all of them.
  const scrubTimeMs = useSharedValue<number | null>(null)

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <IconButton
          icon={BracketsCurlyIcon}
          onPress={() => router.push(routes.controlBatteryRaw)}
          accessibilityLabel="Raw BMS data"
        />
      ),
    })
  }, [navigation, router])

  useFocusEffect(
    useCallback(() => {
      acquireBmsSeriesStream()
      return releaseBmsSeriesStream
    }, []),
  )

  const percentPoints = useMemo(() => toTelemetryChartPoints(batteryPercent), [batteryPercent])
  const voltagePoints = useMemo(() => toTelemetryChartPoints(batteryVoltage), [batteryVoltage])
  const currentPoints = useMemo(() => toTelemetryChartPoints(batteryCurrent), [batteryCurrent])

  const board = useBoardStore((s) => s.boards.find((b) => b.id === s.activeBoardId))
  const battery = useMemo(
    () => deriveBatteryConfig(board?.batteryConfig ?? null),
    [board?.batteryConfig],
  )

  // Pin the V axis to the pack's 0%..100% span so the V line plots at the same height as the
  // % line and only sag under load separates them. Auto-ranging stretches noise to full height.
  const voltageRange = useMemo(() => {
    if (battery.warning == null) {
      return { y: { min: battery.minVoltage, max: battery.maxVoltage } }
    }
    return computeAutoRange(voltagePoints, {
      includeZero: false,
      minSpan: 5,
      paddingRatio: 0.1,
      fallbackMin: 30,
      fallbackMax: 60,
    })
  }, [battery, voltagePoints])
  const currentRange = useMemo(
    () => computeAutoRange(currentPoints, { baseline: battCurrentCfg.chartRange }),
    [currentPoints],
  )

  const voltageSecondary = useMemo(
    () => ({
      points: voltagePoints,
      range: voltageRange,
      color: theme.alpha(neutral.textDim, 0.6),
      formatValue: formatVoltage,
    }),
    [neutral.textDim, voltagePoints, voltageRange],
  )

  // Gauge reads the latest of the calm ~1Hz decimated series — the same SoC source/cadence the
  // center BatteryIndicator uses. The per-frame `liveTelemetryRuntime` tick carries the identical
  // smoothed estimate but updates every BLE frame, which made the big % readout jitter.
  const latestPercent = batteryPercent.at(-1)?.value ?? null
  const percentValue = useSharedValue<number | null>(latestPercent)
  useEffect(() => {
    percentValue.value = latestPercent
  }, [latestPercent, percentValue])

  return (
    <ControlDetailLayout
      title="Battery"
      controlId={battVoltageCfg.controlId}
      unit={battVoltageCfg.unit}
      liveValue={percentValue}
    >
      {/* Cell groups sit above the charts so a scrubbing thumb doesn't cover them. */}
      <BmsCellVoltages scrubTimeMs={scrubTimeMs} windowMs={windowMs} />
      <MetricDetailChart
        metric={battPercentCfg}
        points={percentPoints}
        range={PERCENT_RANGE}
        formatValue={formatPercent}
        windowMs={windowMs}
        secondary={voltageSecondary}
        scrubTimeMs={scrubTimeMs}
        height={80}
      />
      <MetricDetailChart
        label={battCurrentCfg.label}
        metric={battCurrentCfg}
        points={currentPoints}
        range={currentRange}
        windowMs={windowMs}
        scrubTimeMs={scrubTimeMs}
        reserveRightAxis
        height={80}
      />
    </ControlDetailLayout>
  )
}
