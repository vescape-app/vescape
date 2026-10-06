import { StyleSheet, View } from 'react-native'
import { router, type Href } from 'expo-router'

import { useMemo, useState, type ReactNode } from 'react'
import { useAnimatedReaction, type SharedValue } from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'
import { GearSixIcon, PulseIcon } from 'phosphor-react-native'

import { IconButton } from '@/components/base/IconButton'
import { SectionHeader } from '@/components/base/SectionHeader'
import { theme } from '@/constants/theme'

import { useUnitSystem } from '@/hooks/useUnitSystem'
import { LiveMetricCard } from '@/modules/board/components/LiveMetricCard'
import {
  presentTelemetryMetric,
  telemetry,
  type TelemetryMetricConfig,
} from '@/modules/board/constants/telemetry'
import { liveTelemetryRuntime } from '@/modules/board/lib/liveTelemetryRuntime'
import { useLiveSeriesGroup, useLiveSeriesMetrics } from '@/modules/board/hooks/useLiveMetric'
import { formatLiveTelemetryDetail } from '@/modules/board/lib/focusedSeriesHeader'
import { useLiveWindowMs, useSettingsStore } from '@/modules/settings/store/settingsStore'
import { routes } from '@/navigation/routes'

interface ListCard {
  /** Caption, `onLiveSeries` key, the metric it draws as and its live reading, per line, and the
   * line's own detail screen where the lines do not share the card's. */
  lines: {
    title: string
    key: string
    metric: TelemetryMetricConfig
    value: SharedValue<number | null>
    route?: Href
  }[]
  /** The detail screen the whole card opens, unless its lines name their own. */
  route?: Href
  testID: string
  /** Which extremes the card marks; see `LiveMetricCard`. */
  peaks?: 'max' | 'range'
}

const live = liveTelemetryRuntime.values

const CARDS: ListCard[] = [
  {
    lines: [{ title: 'Speed', key: 'speed', metric: telemetry.speed, value: live.speedKmh }],
    route: routes.controlSpeed,
    testID: 'telemetry-list-speed',
    peaks: 'max',
  },
  {
    lines: [{ title: 'Duty cycle', key: 'duty', metric: telemetry.duty, value: live.dutyPercent }],
    route: routes.controlDuty,
    testID: 'telemetry-list-duty',
    peaks: 'max',
  },
  {
    lines: [
      {
        title: 'Motor temp',
        key: 'motorTemp',
        metric: telemetry.motorTemp,
        value: live.motorTemp,
        route: routes.controlMotorTemp,
      },
      {
        title: 'Ctrl temp',
        key: 'controllerTemp',
        metric: telemetry.controllerTemp,
        value: live.controllerTemp,
        route: routes.controlControllerTemp,
      },
    ],
    testID: 'telemetry-list-temps',
    peaks: 'max',
  },
  {
    lines: [
      {
        title: 'Motor current',
        key: 'motorCurrent',
        metric: telemetry.motorCurrent,
        value: live.motorCurrent,
      },
    ],
    route: routes.controlMotorCurrent,
    testID: 'telemetry-list-motor-current',
    peaks: 'range',
  },
  {
    lines: [
      {
        title: 'Battery current',
        key: 'batteryCurrent',
        metric: telemetry.battCurrent,
        value: live.batteryCurrent,
      },
    ],
    route: routes.controlBatteryCurrent,
    testID: 'telemetry-list-battery-current',
    peaks: 'range',
  },
  {
    lines: [
      {
        title: 'Battery',
        key: 'batteryVoltage',
        metric: telemetry.battVoltage,
        value: live.batteryVoltage,
      },
    ],
    route: routes.controlBattery,
    testID: 'telemetry-list-battery',
  },
  {
    lines: [
      {
        title: 'Footpad ADC 1',
        key: 'footpadAdc1',
        metric: telemetry.footpadAdc1,
        value: live.adc1,
      },
      {
        title: 'Footpad ADC 2',
        key: 'footpadAdc2',
        metric: telemetry.footpadAdc2,
        value: live.adc2,
      },
    ],
    route: routes.controlFootpad,
    testID: 'telemetry-list-footpad',
  },
  {
    lines: [
      { title: 'Pitch', key: 'pitch', metric: telemetry.pitch, value: live.pitch },
      { title: 'Roll', key: 'roll', metric: telemetry.roll, value: live.roll },
    ],
    route: routes.controlImu,
    testID: 'telemetry-list-imu',
  },
]

const SERIES_KEYS = CARDS.flatMap((card) => card.lines.map((line) => line.key))

/**
 * Every live metric over the recent window, one card each, opening its detail screen. Native
 * streams the series only while the list is mounted.
 */
interface LiveTelemetryListProps {
  /** Action in the header's top-left corner, opposite the settings link. */
  headerStart?: ReactNode
}

export function LiveTelemetryList({ headerStart }: LiveTelemetryListProps) {
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
      CARDS.map((card) =>
        card.lines.map((line) => ({ ...line, metric: presentTelemetryMetric(line.metric, units) })),
      ),
    [units],
  )

  return (
    <View style={styles.list}>
      <View style={styles.header}>
        <SectionHeader
          icon={PulseIcon}
          color={theme.palette.blue.color}
          title="Live telemetry"
          description={formatLiveTelemetryDetail(spanMs, configuredMinutes, rateHz)}
          align="center"
        />
        {headerStart ? <View style={styles.headerStart}>{headerStart}</View> : null}
        <IconButton
          icon={GearSixIcon}
          onPress={() => router.push(routes.settingsLiveTelemetry)}
          style={styles.settings}
          accessibilityLabel="Live telemetry settings"
          testID="telemetry-list-settings"
        />
      </View>
      <View style={styles.cards}>
        {CARDS.map((card, cardIndex) => (
          <LiveMetricCard
            key={card.testID}
            lines={presented[cardIndex].map(({ title, key, metric, value, route }) => ({
              title,
              metric,
              value,
              points: series[key],
              onPress: route ? () => router.push(route) : undefined,
            }))}
            windowMs={windowMs}
            peaks={card.peaks}
            onPress={() => card.route && router.push(card.route)}
            testID={card.testID}
          />
        ))}
      </View>
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
    paddingBottom: 16,
  },
  cards: {
    paddingHorizontal: 12,
    gap: 8,
  },
  headerStart: {
    position: 'absolute',
    top: 0,
    left: 16,
  },
  settings: {
    position: 'absolute',
    top: 0,
    right: 16,
  },
})
