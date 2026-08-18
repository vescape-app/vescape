import { useLayoutEffect, useEffect, useMemo, useCallback } from 'react'
import { useNavigation, useRouter, useFocusEffect } from 'expo-router'
import { BracketsCurlyIcon } from 'phosphor-react-native'
import { useSharedValue } from 'react-native-reanimated'

import { BmsCellVoltages } from '@/modules/battery/components/BmsCellVoltages'
import { ControlDetailLayout } from '@/modules/board/components/ControlDetailLayout'
import { LiveChartStack } from '@/modules/board/components/LiveChartStack'
import { toChartSeries, toLiveChart } from '@/modules/board/components/metricDetailData'
import { IconButton } from '@/components/base/IconButton'
import { computeAutoRangeFromValues } from '@/components/charts/chartMath'
import { telemetry } from '@/modules/board/constants/telemetry'
import { theme } from '@/constants/theme'
import { useLiveMetric, liveSelectors } from '@/modules/board/hooks/useLiveMetric'
import { deriveBatteryConfig } from '@/modules/battery/lib'
import { useRenderRateWarning } from '@/hooks/useRenderRateWarning'
import { useBoardStore } from '@/modules/board/store/boardStore'
import { acquireBmsSeriesStream, releaseBmsSeriesStream } from '@/modules/board/store/bleStore'
import { routes } from '@/navigation/routes'
import { useLiveWindowMs } from '@/modules/settings/store/settingsStore'

const battVoltageCfg = telemetry.battVoltage
const battCurrentCfg = telemetry.battCurrent
const battPercentCfg = { ...battVoltageCfg, unit: '%', decimals: 0 }

const PERCENT_RANGE = { min: 0, max: 100 }
/** Battery % is the main line; voltage rides under it as a dim, de-emphasized gray. */
const VOLTAGE_LINE_COLOR = theme.palette.slate.textMuted

export default function BatteryScreen() {
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

  const percentSeries = useMemo(
    () => toChartSeries(batteryPercent, windowMs),
    [batteryPercent, windowMs],
  )
  const voltageSeries = useMemo(
    () => toChartSeries(batteryVoltage, windowMs),
    [batteryVoltage, windowMs],
  )
  const currentSeries = useMemo(
    () => toChartSeries(batteryCurrent, windowMs),
    [batteryCurrent, windowMs],
  )

  const board = useBoardStore((s) => s.boards.find((b) => b.id === s.activeBoardId))
  const battery = useMemo(
    () => deriveBatteryConfig(board?.batteryConfig ?? null),
    [board?.batteryConfig],
  )

  // Pin the V axis to the pack's 0%..100% span so the V line plots at the same height as the
  // % line and only sag under load separates them. Auto-ranging stretches noise to full height.
  const voltageRange = useMemo(() => {
    if (battery.warning == null) {
      return { min: battery.minVoltage, max: battery.maxVoltage }
    }
    return computeAutoRangeFromValues(voltageSeries.vs, {
      includeZero: false,
      minSpan: 5,
      paddingRatio: 0.1,
      fallbackMin: 30,
      fallbackMax: 60,
    })
  }, [battery, voltageSeries])

  // Pack percent with voltage riding on the right axis, then pack current — one stack, so
  // scrubbing either also moves the cell card above them.
  const charts = useMemo(
    () => [
      toLiveChart({
        key: 'batteryPercent',
        metric: battPercentCfg,
        data: percentSeries,
        range: PERCENT_RANGE,
        secondary: {
          key: 'batteryVoltage',
          data: voltageSeries,
          range: voltageRange,
          color: VOLTAGE_LINE_COLOR,
          label: battVoltageCfg.label,
          unit: battVoltageCfg.unit,
          decimals: battVoltageCfg.decimals,
        },
      }),
      toLiveChart({
        key: 'batteryCurrent',
        metric: battCurrentCfg,
        data: currentSeries,
        range: computeAutoRangeFromValues(currentSeries.vs, {
          baseline: battCurrentCfg.chartRange,
        }),
      }),
    ],
    [currentSeries, percentSeries, voltageRange, voltageSeries],
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
      <LiveChartStack charts={charts} scrubTimeMs={scrubTimeMs} />
    </ControlDetailLayout>
  )
}
