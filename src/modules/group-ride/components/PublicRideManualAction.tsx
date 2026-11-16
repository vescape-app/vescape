import { BroadcastIcon, type Icon } from 'phosphor-react-native'
import { StyleSheet, View } from 'react-native'
import Svg, { Line } from 'react-native-svg'
import type { PublicRideStatus } from 'vescape-core'

import { Button } from '@/components/base/Button'
import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'

const BroadcastOffIcon: Icon = ({ size, color, weight }) => (
  <View>
    <BroadcastIcon size={size} color={color} weight={weight} />
    <Svg
      pointerEvents="none"
      style={StyleSheet.absoluteFill}
      width={size}
      height={size}
      viewBox="0 0 24 24"
    >
      <Line x1={4} y1={4} x2={20} y2={20} stroke={theme.control.background} strokeWidth={6} />
      <Line x1={4} y1={4} x2={20} y2={20} stroke={color} strokeWidth={2.5} strokeLinecap="round" />
    </Svg>
  </View>
)

export function PublicRideManualAction({
  activation,
  onChange,
}: {
  activation: Extract<PublicRideStatus['activation'], 'waiting' | 'phone'>
  onChange: (enabled: boolean) => void
}) {
  const sharing = activation === 'phone'
  return (
    <View style={styles.actions}>
      {!sharing ? (
        <Text style={styles.waiting}>Sharing starts when your board connects.</Text>
      ) : null}
      <Button
        label={sharing ? 'Wait for my board' : 'Share my location without a board'}
        icon={sharing ? BroadcastOffIcon : BroadcastIcon}
        variant={sharing ? 'secondary' : 'groupRide'}
        onPress={() => onChange(!sharing)}
        testID="public-ride-manual-sharing"
      />
    </View>
  )
}

const styles = StyleSheet.create({
  actions: { alignItems: 'center', gap: 10 },
  waiting: { color: theme.status.warning.color, textAlign: 'center' },
})
