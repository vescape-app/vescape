import { StyleSheet, View } from 'react-native'
import {
  BroadcastIcon,
  CpuIcon,
  GaugeIcon,
  MapTrifoldIcon,
  ThermometerIcon,
} from 'phosphor-react-native'

import { Button } from '@/components/base/Button'
import { SectionHeader } from '@/components/base/SectionHeader'
import { Text } from '@/components/base/Text'
import { useResolvedSecondaryWidgetSurface } from '@/components/widgets/widgetSurface'
import { theme } from '@/constants/theme'
import { useFormat } from '@/hooks/useFormat'
import { RiderDeviceStatus } from '@/modules/group-ride/components/RiderDeviceStatus'
import { TELEMETRY_LEVEL_COLOR } from '@/modules/board/constants/telemetryThresholds'
import { useRiderStats } from '@/modules/group-ride/hooks/useRiderStats'
import { batteryVisual } from '@/modules/group-ride/lib/batteryVisual'
import type { RiderReadings } from '@/modules/group-ride/lib/riderStats'
import { ProfileStatsGrid } from '@/modules/profile/components/ProfileStatsGrid'

export function RiderLiveRide({
  readings,
  onShowOnMap,
}: {
  readings: RiderReadings
  onShowOnMap?: () => void
}) {
  const surface = useResolvedSecondaryWidgetSurface()
  const { speedUnit } = useFormat()
  const { speed, soc, motor, ctrl, phone } = useRiderStats(readings)
  const battery = batteryVisual(readings.soc)
  const boardName = readings.boardName
  const metrics = [
    {
      key: 'speed',
      label: 'Speed',
      value: speed.value && `${speed.value} ${speedUnit}`,
      icon: GaugeIcon,
      accent: theme.telemetry.speed,
    },
    {
      key: 'battery',
      label: 'Battery',
      value: soc.value,
      icon: battery.icon,
      accent: battery.iconColor,
      valueColor: battery.textColor,
    },
    {
      key: 'controller',
      label: 'Controller',
      value: ctrl.value,
      icon: CpuIcon,
      accent:
        ctrl.level !== 'normal'
          ? TELEMETRY_LEVEL_COLOR[ctrl.level]
          : theme.telemetry.controllerTemp,
      valueColor: ctrl.level !== 'normal' ? TELEMETRY_LEVEL_COLOR[ctrl.level] : undefined,
    },
    {
      key: 'motor',
      label: 'Motor',
      value: motor.value,
      icon: ThermometerIcon,
      accent:
        motor.level !== 'normal' ? TELEMETRY_LEVEL_COLOR[motor.level] : theme.telemetry.motorTemp,
      valueColor: motor.level !== 'normal' ? TELEMETRY_LEVEL_COLOR[motor.level] : undefined,
    },
  ] as const
  const items = metrics.flatMap((metric) =>
    metric.value ? [{ ...metric, value: metric.value }] : [],
  )
  const boardConnected = Boolean(boardName || items.length)
  if (!boardConnected && !phone.value) return null

  return (
    <View style={styles.section}>
      <SectionHeader title="Live ride" icon={BroadcastIcon} color={theme.palette.green.color} />
      <View style={[surface, styles.box]}>
        {boardName ? <Text style={styles.board}>{boardName}</Text> : null}
        {items.length > 0 ? <ProfileStatsGrid columns={4} items={items} /> : null}
        {!boardConnected || phone.value || onShowOnMap ? (
          <View style={styles.footer}>
            <View style={styles.status}>
              <RiderDeviceStatus boardConnected={boardConnected} phoneBattery={phone.value} />
            </View>
            {onShowOnMap ? (
              <Button
                label="Show on map"
                icon={MapTrifoldIcon}
                size="sm"
                variant="groupRide"
                onPress={onShowOnMap}
              />
            ) : null}
          </View>
        ) : null}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  section: { gap: 10 },
  box: { padding: 16, gap: 6 },
  board: { fontSize: 16, fontWeight: '700' },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  status: { flex: 1, minWidth: 0 },
})
