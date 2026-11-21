import { useLayoutEffect, useEffect, useMemo, useCallback } from 'react'
import { useNavigation, useRouter, useFocusEffect } from 'expo-router'
import { BracketsCurlyIcon } from 'phosphor-react-native'
import { useSharedValue } from 'react-native-reanimated'

import { BmsCellVoltages } from '@/modules/battery/components/BmsCellVoltages'
import { MotorConfigSection } from '@/modules/board/components/MotorConfigSection'
import { ControlDetailLayout } from '@/modules/board/components/ControlDetailLayout'
import { BoardConfigSection } from '@/modules/board/components/BoardConfigSection'
import { BATTERY_CONFIG_ROWS } from '@/modules/board/constants/boardConfigRows'
import { LiveChartStack } from '@/modules/board/components/LiveChartStack'
import { toChartSeries, toLiveChart } from '@/modules/board/components/metricDetailData'
import { IconButton } from '@/components/base/IconButton'
import { computeAutoRangeFromValues } from '@/components/charts/chartMath'
import { BATTERY_MOTOR_CONFIG_ROWS } from '@/modules/board/constants/motorConfigRows'
import { telemetry } from '@/modules/board/constants/telemetry'
import { theme } from '@/constants/theme'
import { useResolvedNeutralColors } from '@/hooks/useTheme'
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

export default function BatteryScreen() {
  const neutral = useResolvedNeutralColors()
  useRenderRateWarning('BatteryScreen')
  const navigation = useNavigation()
  const router = useRouter()
  const batteryPercent = useLiveMetric(liveSelectors.batteryPercent)
  const batteryVoltage = useLiveMetric(liveSelectors.batteryVoltage)
  const batteryCurrent = useLiveMetric(liveSelectors.batteryCurrent)
  const windowMs = useLiveWindowMs()

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
          color: theme.alpha(neutral.textDim, 0.6),
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
    [currentSeries, neutral.textDim, percentSeries, voltageRange, voltageSeries],
  )

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
      <BmsCellVoltages scrubTimeMs={scrubTimeMs} windowMs={windowMs} />
      <LiveChartStack charts={charts} scrubTimeMs={scrubTimeMs} />
      <BoardConfigSection rows={BATTERY_CONFIG_ROWS} />
      <MotorConfigSection rows={BATTERY_MOTOR_CONFIG_ROWS} />
    </ControlDetailLayout>
  )
}
