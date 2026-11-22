import { useMemo } from 'react'
import type { StyleProp, ViewStyle } from 'react-native'
import { useRouter } from 'expo-router'
import { useShallow } from 'zustand/react/shallow'

import { LinearGauge } from '@/components/charts/LinearGauge'
import { telemetry } from '@/modules/board/constants/telemetry'
import { TELEMETRY_THRESHOLDS } from '@/modules/board/constants/telemetryThresholds'
import { theme, type ThemeColor } from '@/constants/theme'
import { deriveBatteryConfig, isBmsCharging, summarizeBms } from '@/modules/battery/lib'
import { fmtTimeAgo } from '@/helpers/format'
import { useLiveSeries } from '@/modules/board/hooks/useLiveMetric'
import { useMinuteNow } from '@/hooks/useMinuteNow'
import { useResolvedNeutralColors } from '@/hooks/useTheme'
import { useResolvedAlertRules } from '@/modules/alerts/hooks/useResolvedAlertRules'
import { gaugeAlertsFor } from '@/modules/alerts/lib/gaugeAlerts'
import { useBleStore } from '@/modules/board/store/bleStore'
import { useBoardStore } from '@/modules/board/store/boardStore'
import { routes } from '@/navigation/routes'

interface BatteryIndicatorProps {
  compact?: boolean
  transparent?: boolean
  containerStyle?: StyleProp<ViewStyle>
}

function pickColor(percent: number | null): ThemeColor {
  if (percent != null && percent < TELEMETRY_THRESHOLDS.battery.warning * 100) {
    return theme.status.warning.color
  }
  return telemetry.battVoltage.color
}

export function BatteryIndicator({ compact, transparent, containerStyle }: BatteryIndicatorProps) {
  const neutral = useResolvedNeutralColors()
  const router = useRouter()
  const batterySeries = useLiveSeries('batteryPercent')
  const voltageSeries = useLiveSeries('batteryVoltage')
  const connected = useBleStore((s) => s.status === 'connected')
  const charging = useBleStore((s) => s.status === 'connected' && isBmsCharging(s.latestBms))
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
  const alertRules = useResolvedAlertRules()

  const stale = !connected && lastBattery != null
  const now = useMinuteNow(stale)

  const batteryConfigured = useMemo(
    () => deriveBatteryConfig(batteryConfig).warning == null,
    [batteryConfig],
  )

  const alerts = useMemo(
    () => (batteryConfigured ? gaugeAlertsFor(alertRules, 'battery') : []),
    [alertRules, batteryConfigured],
  )

  const livePercent = batteryConfigured ? (batterySeries.at(-1)?.value ?? null) : null
  const liveVoltage = voltageSeries.at(-1)?.value ?? null
  const percent = stale ? lastBattery.percent : livePercent
  const voltage = stale ? lastBattery.voltage : liveVoltage

  const aux = stale
    ? [
        voltage != null ? telemetry.battVoltage.formatWithUnit(voltage) : null,
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
      color={stale ? neutral.textSecondary : pickColor(percent)}
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
