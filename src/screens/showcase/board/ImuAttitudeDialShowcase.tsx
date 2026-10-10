import { useEffect, useState } from 'react'
import { useSharedValue } from 'react-native-reanimated'

import { ShowcaseCard } from '@/components/dev/ShowcaseCard'
import { ChipRow, ToggleRow } from '@/components/dev/ShowcaseControls'
import { ImuAttitudeDial } from '@/modules/board/components/ImuAttitudeDial'

/** Pitch, roll and balance setpoint per pose; `null` is no telemetry yet. */
const POSES: Record<string, [number, number, number] | null> = {
  level: [0, 0, 0],
  'nose up': [6, -2, 1.5],
  'carving left': [2, -18, 1],
  'off balance': [12, 3, 1],
  'past scale': [45, 40, -35],
  'no data': null,
}

export function ImuAttitudeDialShowcase() {
  'use no memo'
  const [pose, setPose] = useState('nose up')
  const [connected, setConnected] = useState(true)
  const pitch = useSharedValue<number | null>(null)
  const roll = useSharedValue<number | null>(null)
  const balancePitch = useSharedValue<number | null>(null)

  useEffect(() => {
    const values = POSES[pose]
    pitch.set(values?.[0] ?? null)
    roll.set(values?.[1] ?? null)
    balancePitch.set(values?.[2] ?? null)
  }, [balancePitch, pitch, pose, roll])

  return (
    <ShowcaseCard
      name="ImuAttitudeDial"
      controls={
        <>
          <ChipRow label="pose" options={Object.keys(POSES)} selected={pose} onSelect={setPose} />
          <ToggleRow label="connected" value={connected} onToggle={setConnected} />
        </>
      }
    >
      <ImuAttitudeDial
        pitch={pitch}
        roll={roll}
        balancePitch={balancePitch}
        connected={connected}
      />
    </ShowcaseCard>
  )
}
