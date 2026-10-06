import { useEffect, useState } from 'react'
import { View } from 'react-native'
import {
  cancelAnimation,
  Easing,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated'

import { ShowcaseCard } from '@/components/dev/ShowcaseCard'
import { ChipRow, ToggleRow } from '@/components/dev/ShowcaseControls'
import { BoardAttitudeIndicator } from '@/modules/board/components/BoardAttitudeIndicator'

const POSES: Record<string, [number, number]> = {
  level: [0, 0],
  riding: [8, 25],
  underside: [3, -28],
  vertical: [90, 0],
  'edge-on': [0, 90],
  inverted: [0, 180],
}

export function BoardAttitudeIndicatorShowcase() {
  'use no memo'
  const [pose, setPose] = useState('level')
  const [connected, setConnected] = useState(true)
  const [sweep, setSweep] = useState(false)
  const pitch = useSharedValue<number | null>(0)
  const roll = useSharedValue<number | null>(0)

  useEffect(() => {
    const [p, r] = POSES[pose]
    pitch.set(p)
    roll.set(r)
    if (sweep) {
      pitch.set(-110)
      roll.set(-180)
      pitch.set(
        withRepeat(
          withTiming(110, { duration: 9000, easing: Easing.inOut(Easing.quad) }),
          -1,
          true,
        ),
      )
      roll.set(
        withRepeat(
          withTiming(180, { duration: 12000, easing: Easing.inOut(Easing.quad) }),
          -1,
          true,
        ),
      )
    }
    return () => {
      cancelAnimation(pitch)
      cancelAnimation(roll)
    }
  }, [pitch, roll, pose, sweep])

  return (
    <ShowcaseCard
      name="BoardAttitudeIndicator"
      controls={
        <>
          <ChipRow
            label="pose"
            options={Object.keys(POSES)}
            selected={pose}
            onSelect={(next) => {
              setSweep(false)
              setPose(next)
            }}
          />
          <ToggleRow label="connected" value={connected} onToggle={setConnected} />
          <ToggleRow label="full roll / pitch sweep" value={sweep} onToggle={setSweep} />
        </>
      }
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around' }}>
        {[48, 64, 144].map((size) => (
          <BoardAttitudeIndicator
            key={size}
            pitch={pitch}
            roll={roll}
            connected={connected}
            size={size}
            testID={`attitude-preview-${size}`}
          />
        ))}
      </View>
    </ShowcaseCard>
  )
}
