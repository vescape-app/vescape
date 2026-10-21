import { useState } from 'react'
import { View } from 'react-native'
import { useSharedValue } from 'react-native-reanimated'

import { ShowcaseCard } from '@/components/dev/ShowcaseCard'
import { Stepper } from '@/components/forms/Stepper'
import { Button } from '@/components/base/Button'
import { LiveNumber } from '@/modules/accessories/components/LiveNumber'
import { SensorBar } from '@/modules/accessories/components/SensorBar'
import { GroundClearanceTiltPreview } from '@/modules/accessories/components/GroundClearanceTiltPreview'
import { useResolvedAccentColors } from '@/hooks/useTheme'

export function SensorReadoutShowcase() {
  const [distance, setDistance] = useState(15)
  const [tiltPercent, setTiltPercent] = useState(-25)
  const value = useSharedValue(15)
  const tilt = useSharedValue(-25)
  const color = useResolvedAccentColors().sky.color
  return (
    <ShowcaseCard name="Live sensor readout">
      <View style={{ gap: 12 }}>
        <LiveNumber value={value} decimals={1} unit="cm" />
        <SensorBar value={value} range={{ min: 3, max: 100 }} color={color} />
        <GroundClearanceTiltPreview value={tilt} />
        <Stepper
          value={tiltPercent}
          min={-100}
          max={100}
          unit="%"
          onChange={(next) => {
            setTiltPercent(next)
            tilt.value = next
          }}
        />
        <Stepper
          value={distance}
          min={3}
          max={100}
          onChange={(next) => {
            setDistance(next)
            value.value = next
          }}
        />
        <Button
          label="Invalid reading"
          variant="secondary"
          onPress={() => {
            value.value = Number.NaN
            tilt.value = Number.NaN
          }}
        />
      </View>
    </ShowcaseCard>
  )
}
