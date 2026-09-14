import { StyleSheet, View } from 'react-native'
import type { SharedValue } from 'react-native-reanimated'

import { Text } from '@/components/base/Text'
import { LiveNumber } from './LiveNumber'

/** Hypothetical sensor output, calculated natively from calibration and a fresh reading. */
export function GroundClearanceTiltPreview({ value }: { value: SharedValue<number> }) {
  return (
    <View style={styles.row}>
      <Text>Tilt preview</Text>
      <LiveNumber value={value} decimals={0} unit="%" />
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
})
