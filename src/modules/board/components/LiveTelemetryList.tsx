import { StyleSheet, View } from 'react-native'
import { router, type Href } from 'expo-router'

import { useMemo, useState } from 'react'
import { useAnimatedReaction, type SharedValue } from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'
import { PulseIcon } from 'phosphor-react-native'

import { SectionHeader } from '@/components/base/SectionHeader'
import { theme } from '@/constants/theme'

import { useUnitSystem } from '@/hooks/useUnitSystem'
import { LiveMetricRow } from '@/modules/board/components/LiveMetricRow'
import {
  presentTelemetryMetric,
  telemetry,
  type TelemetryMetricConfig,
} from '@/modules/board/constants/telemetry'
import { liveTelemetryRuntime } from '@/modules/board/lib/liveTelemetryRuntime'
import { useLiveSeriesGroup, useLiveSeriesMetrics } from '@/modules/board/hooks/useLiveMetric'
import { formatFocusedSeriesSpan } from '@/modules/board/lib/focusedSeriesHeader'
import { useLiveWindowMs, useSettingsStore } from '@/modules/settings/store/settingsStore'
import { routes } from '@/navigation/routes'

interface ListRow {
  title: string
  /** `onLiveSeries` key, the metric it draws as and its live reading. */
  lines: { key: string; metric: TelemetryMetricConfig; value: SharedValue<number | null> }[]
  route: Href
  testID: string
}

const live = liveTelemetryRuntime.values

const ROWS: ListRow[] = [
  {
    title: 'Speed',
    lines: [{ key: 'speed', metric: telemetry.speed, value: live.speedKmh }],
    route: routes.controlSpeed,
    testID: 'telemetry-list-speed',
  },
  {
    title: 'Duty cycle',
    lines: [{ key: 'duty', metric: telemetry.duty, value: live.dutyPercent }],
    route: routes.controlDuty,
    testID: 'telemetry-list-duty',
  },
  {
    title: 'Motor temp',
    lines: [{ key: 'motorTemp', metric: telemetry.motorTemp, value: live.motorTemp }],
    route: routes.controlMotorTemp,
    testID: 'telemetry-list-motor-temp',
  },
  {
    title: 'Controller temp',
    lines: [
      { key: 'controllerTemp', metric: telemetry.controllerTemp, value: live.controllerTemp },
    ],
    route: routes.controlControllerTemp,
    testID: 'telemetry-list-controller-temp',
  },
  {
    title: 'Motor current',
    lines: [{ key: 'motorCurrent', metric: telemetry.motorCurrent, value: live.motorCurrent }],
    route: routes.controlMotorCurrent,
    testID: 'telemetry-list-motor-current',
  },
  {
    title: 'Battery current',
    lines: [{ key: 'batteryCurrent', metric: telemetry.battCurrent, value: live.batteryCurrent }],
    route: routes.controlBatteryCurrent,
    testID: 'telemetry-list-battery-current',
  },
  {
    title: 'Battery',
    lines: [{ key: 'batteryVoltage', metric: telemetry.battVoltage, value: live.batteryVoltage }],
    route: routes.controlBattery,
    testID: 'telemetry-list-battery',
  },
  {
    title: 'Footpad',
    lines: [
      { key: 'footpadAdc1', metric: telemetry.footpadAdc1, value: live.adc1 },
      { key: 'footpadAdc2', metric: telemetry.footpadAdc2, value: live.adc2 },
    ],
    route: routes.controlFootpad,
    testID: 'telemetry-list-footpad',
  },
  {
    title: 'Pitch · roll',
    lines: [
      { key: 'pitch', metric: telemetry.pitch, value: live.pitch },
      { key: 'roll', metric: telemetry.roll, value: live.roll },
    ],
    route: routes.controlImu,
    testID: 'telemetry-list-imu',
  },
]

const SERIES_KEYS = ROWS.flatMap((row) => row.lines.map((line) => line.key))

/**
 * Every live metric over the recent window, one row each, opening its detail screen. Native
 * streams the series only while the list is mounted.
 */
export function LiveTelemetryList() {
  useLiveSeriesMetrics(SERIES_KEYS)
  const series = useLiveSeriesGroup(SERIES_KEYS)
  const windowMs = useLiveWindowMs()
  const units = useUnitSystem()
  const configuredMinutes = useSettingsStore((s) => s.liveHistoryLimit)
  const rateHz = useRoundedPacketRate()
  // How far back the charts actually reach, which is short of the window early in a session.
  let spanMs = 0
  for (const points of Object.values(series)) {
    if (points.length > 1) spanMs = Math.max(spanMs, points[points.length - 1].ts - points[0].ts)
  }
  const presented = useMemo(
    () =>
      ROWS.map((row) =>
        row.lines.map((line) => ({ ...line, metric: presentTelemetryMetric(line.metric, units) })),
      ),
    [units],
  )

  return (
    <View style={styles.list}>
      <View style={styles.header}>
        <SectionHeader
          icon={PulseIcon}
          color={theme.palette.blue.color}
          title={formatFocusedSeriesSpan(spanMs, configuredMinutes)}
          description={rateHz == null ? 'Waiting for data' : `Live data at ~${rateHz} Hz`}
          align="center"
        />
      </View>
      {ROWS.map((row, rowIndex) => (
        <LiveMetricRow
          key={row.testID}
          title={row.title}
          lines={presented[rowIndex].map(({ key, metric, value }) => ({
            metric,
            value,
            points: series[key],
          }))}
          windowMs={windowMs}
          onPress={() => router.push(row.route)}
          testID={row.testID}
        />
      ))}
    </View>
  )
}

/** The board's packet rate, re-rendering only when its whole-Hz reading changes. */
function useRoundedPacketRate(): number | null {
  const [rate, setRate] = useState<number | null>(null)
  useAnimatedReaction(
    () => {
      const v = live.pullRateHz.value
      return v == null || v <= 0 ? null : Math.round(v)
    },
    (next, previous) => {
      if (next !== previous) scheduleOnRN(setRate, next)
    },
  )
  return rate
}

const styles = StyleSheet.create({
  list: {
    width: '100%',
  },
  header: {
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
})
