import { StyleSheet, View } from 'react-native'
import {
  BatteryMediumIcon,
  BroadcastIcon,
  ClockIcon,
  CpuIcon,
  DeviceMobileIcon,
  GaugeIcon,
  MapTrifoldIcon,
  ThermometerIcon,
} from 'phosphor-react-native'

import { Button } from '@/components/base/Button'
import { SectionHeader } from '@/components/base/SectionHeader'
import { Text } from '@/components/base/Text'
import { useResolvedSecondaryWidgetSurface } from '@/components/widgets/widgetSurface'
import { theme } from '@/constants/theme'
import { fmtTimeAgo } from '@/helpers/format'
import { useFormat } from '@/hooks/useFormat'
import { useMinuteNow } from '@/hooks/useMinuteNow'
import { useRiderStats } from '@/modules/group-ride/hooks/useRiderStats'
import type { RiderReadings } from '@/modules/group-ride/lib/riderStats'
import { ProfileStatsGrid } from '@/modules/profile/components/ProfileStatsGrid'

export function RiderLiveRide({
  readings,
  stale = false,
  lastSeen = 0,
  onShowOnMap,
}: {
  readings: RiderReadings
  stale?: boolean
  lastSeen?: number
  onShowOnMap?: () => void
}) {
  const surface = useResolvedSecondaryWidgetSurface()
  const { speedUnit } = useFormat()
  const { speed, soc, motor, ctrl, phone } = useRiderStats(readings)
  const now = useMinuteNow(stale)
  const tone = stale ? theme.palette.amber : theme.palette.green
  const boardName = readings.boardName ?? (speed.value == null ? 'Board disconnected' : null)
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
    {
      key: 'phone',
      label: 'Phone',
      value: phone.value,
      icon: DeviceMobileIcon,
      accent: theme.palette.cyan.color,
    },
  ] as const

  return (
    <View style={styles.section}>
      <SectionHeader
        title={stale ? 'Last known ride' : 'Live ride'}
        icon={stale ? ClockIcon : BroadcastIcon}
        color={tone.color}
      />
      <View style={[surface, styles.box]}>
        {boardName ? <Text style={styles.board}>{boardName}</Text> : null}
        {stale && lastSeen > 0 ? (
          <Text style={styles.caption}>Updated {fmtTimeAgo(lastSeen, now)}</Text>
        ) : null}
        <ProfileStatsGrid
          columns={4}
          items={metrics.flatMap((metric) =>
            metric.value ? [{ ...metric, value: metric.value }] : [],
          )}
        />
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
  caption: { color: theme.neutral.textSecondary, fontSize: 11 },
  map: { alignSelf: 'flex-end' },
})
