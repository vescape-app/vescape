import { useMemo } from 'react'
import type { StyleProp, ViewStyle } from 'react-native'
import { useRouter } from 'expo-router'
import { useShallow } from 'zustand/react/shallow'

import { LinearGauge } from '@/components/charts/LinearGauge'
import { type DualGaugeAlert } from '@/components/charts/gaugeAlert'
import { telemetry } from '@/modules/board/constants/telemetry'
import { TELEMETRY_THRESHOLDS } from '@/modules/board/constants/telemetryThresholds'
import { theme } from '@/constants/theme'
import { deriveBatteryConfig, isBmsCharging, summarizeBms } from '@/modules/battery/lib'
import { fmtTimeAgo } from '@/helpers/format'
import { useLiveSeries } from '@/modules/board/hooks/useLiveMetric'
import { useMinuteNow } from '@/hooks/useMinuteNow'
import { useAlertsStore } from '@/modules/alerts/store/alertsStore'
import { useBleStore } from '@/modules/board/store/bleStore'
import { useBoardStore } from '@/modules/board/store/boardStore'
import { routes } from '@/navigation/routes'

interface BatteryIndicatorProps {
  compact?: boolean
  transparent?: boolean
  containerStyle?: StyleProp<ViewStyle>
}

/** Warning shade when low on charge, else the battery metric color. Mirrors the gauge fill.
 *  Threshold sourced from the shared telemetry thresholds (battery.warning is a
 *  0-1 fraction; battery percent is 0-100). */
function pickColor(percent: number | null): string {
  if (percent != null && percent < TELEMETRY_THRESHOLDS.battery.warning * 100) {
    return theme.status.warning.color
  }
  return telemetry.battVoltage.color
}

export function BatteryIndicator({ compact, transparent, containerStyle }: BatteryIndicatorProps) {
  const router = useRouter()
  // Decimated series (native, ~1Hz). Battery is a slow signal, so the series cadence both
  // supplies the latest SoC/voltage sample and paces this component's re-render.
  const batterySeries = useLiveSeries('batteryPercent')
  const voltageSeries = useLiveSeries('batteryVoltage')
  const connected = useBleStore((s) => s.status === 'connected')
  const charging = useBleStore((s) => s.status === 'connected' && isBmsCharging(s.latestBms))
  // Cell spread rounded to display resolution (mV step) in the selector, so
  // noise below it doesn't re-render the card on every BMS event.
  const spreadV = useBleStore((s) => {
    if (s.status !== 'connected') return null
    const spread = summarizeBms(s.latestBms)?.spread
    return spread == null ? null : Math.round(spread * 1000) / 1000
  })
  const { batteryConfig, hasBoard, lastBattery } = useBoardStore(
    useShallow((s) => {
      const board = s.boards.find((b) => b.id === s.activeBoardId)
      return {
        batteryConfig: board?.batteryConfig ?? null,
        hasBoard: board != null,
        lastBattery: board?.lastBattery ?? null,
      }
    }),
  )
  const alertRules = useAlertsStore((s) => s.rules)

  // Disconnected with a natively persisted reading: show it dimmed with its age.
  const stale = !connected && lastBattery != null
  const now = useMinuteNow(stale)

  // Config gates whether a SoC reading exists at all (voltage limits set).
  const batteryConfigured = useMemo(
    () => deriveBatteryConfig(batteryConfig).warning == null,
    [batteryConfig],
  )

  // Battery alert thresholds are percent-scaled, so they only map onto the 0–100 bar once a
  // pack config exists. Hide them (and show the hint) until then.
  const alerts = useMemo<DualGaugeAlert[]>(
    () =>
      batteryConfigured
        ? alertRules
            .filter((rule) => rule.enabled && rule.controlId === 'battery')
            .map((rule) => ({
              id: rule.id,
              threshold: rule.threshold,
              thresholdMax: rule.thresholdMax,
              repeats: rule.repeatEverySeconds != null,
            }))
        : [],
    [alertRules, batteryConfigured],
  )

  const livePercent = batteryConfigured ? (batterySeries.at(-1)?.value ?? null) : null
  const liveVoltage = voltageSeries.at(-1)?.value ?? null
  const percent = stale ? lastBattery.percent : livePercent
  const voltage = stale ? lastBattery.voltage : liveVoltage

  const aux = stale
    ? [
        voltage != null ? telemetry.battVoltage.formatWithUnit(voltage) : null,
        // Recent readings read as current; only flag the age once it's over an hour old.
        now - lastBattery.at >= 3_600_000 ? fmtTimeAgo(lastBattery.at, now) : null,
      ]
        .filter(Boolean)
        .join(' · ') || undefined
    : [
        voltage != null ? telemetry.battVoltage.formatWithUnit(voltage) : null,
        spreadV != null ? `Δ ${spreadV.toFixed(3)}V` : null,
      ]
        .filter(Boolean)
        .join(' · ') || undefined

  return (
    <LinearGauge
      value={percent}
      max={100}
      color={stale ? theme.palette.slate.textSecondary : pickColor(percent)}
      unit="%"
      alerts={alerts}
      aux={aux}
      charging={charging}
      hint={
        !batteryConfigured && hasBoard && !stale
          ? 'Set battery config in board settings'
          : undefined
      }
      compact={compact}
      transparent={transparent}
      containerStyle={containerStyle}
      onPress={() => router.push(hasBoard ? routes.controlBattery : routes.addBoard)}
      testID="battery-bar"
    />
  )
}
