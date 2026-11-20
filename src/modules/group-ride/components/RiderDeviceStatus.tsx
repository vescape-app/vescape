import { StyleSheet, View } from 'react-native'
import { DeviceMobileIcon, PlugIcon } from 'phosphor-react-native'

import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'

export function RiderDeviceStatus({
  boardConnected,
  phoneBattery,
}: {
  boardConnected: boolean
  phoneBattery?: string
}) {
  if (boardConnected && phoneBattery == null) return null

  return (
    <View style={styles.row}>
      {!boardConnected ? (
        <View style={styles.item}>
          <PlugIcon size={16} color={theme.neutral.textSecondary} />
          <Text style={styles.label}>No board connected</Text>
        </View>
      ) : null}
      {phoneBattery != null ? (
        <View style={styles.item}>
          <DeviceMobileIcon size={16} color={theme.palette.cyan.color} />
          <Text style={styles.label}>Phone battery</Text>
          <Text style={styles.value}>{phoneBattery}</Text>
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: 16,
    rowGap: 6,
  },
  item: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  label: { color: theme.neutral.textSecondary, fontSize: 12 },
  value: { color: theme.neutral.textPrimary, fontSize: 12, fontWeight: '700' },
})
