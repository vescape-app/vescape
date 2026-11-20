import { StyleSheet, View } from 'react-native'
import {
  BatteryMediumIcon,
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
import { useRiderStats } from '@/modules/group-ride/hooks/useRiderStats'
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
      icon: BatteryMediumIcon,
      accent: theme.palette.green.color,
    },
    {
      key: 'controller',
      label: 'Controller',
      value: ctrl.value,
      icon: CpuIcon,
      accent: theme.telemetry.controllerTemp,
    },
    {
      key: 'motor',
      label: 'Motor',
      value: motor.value,
      icon: ThermometerIcon,
      accent: theme.telemetry.motorTemp,
    },
  ] as const
  const items = metrics.flatMap((metric) =>
    metric.value ? [{ ...metric, value: metric.value }] : [],
  )
  const boardConnected = Boolean(boardName || items.length)
  if (!boardConnected && !phone.value) return null

  return (
    <View style={styles.section}>
      {boardConnected ? (
        <SectionHeader title="Live ride" icon={BroadcastIcon} color={theme.palette.green.color} />
      ) : null}
      <View style={[surface, styles.box]}>
        {boardName ? <Text style={styles.board}>{boardName}</Text> : null}
        {items.length > 0 ? <ProfileStatsGrid columns={4} items={items} /> : null}
        <RiderDeviceStatus boardConnected={boardConnected} phoneBattery={phone.value} />
        {onShowOnMap ? (
          <Button
            label="Show on map"
            icon={MapTrifoldIcon}
            size="sm"
            variant="groupRide"
            style={styles.map}
            onPress={onShowOnMap}
          />
        ) : null}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  section: { gap: 10 },
  box: { padding: 15, gap: 6 },
  board: { fontSize: 16, fontWeight: '700' },
  map: { alignSelf: 'flex-end' },
})
