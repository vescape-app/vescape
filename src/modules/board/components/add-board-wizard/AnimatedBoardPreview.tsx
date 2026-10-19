/* eslint-disable react-hooks/immutability */
// A small, continuously moving preview of the selected rail shape and color.
import { useEffect } from 'react'
import {
  cancelAnimation,
  useDerivedValue,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated'

import { BoardAttitudeIndicator } from '@/modules/board/components/BoardAttitudeIndicator'
import type { RailId } from '@/modules/board/lib/railPresets'

export function AnimatedBoardPreview({
  railId,
  railColorId,
  size = 170,
}: {
  railId: RailId
  railColorId: string
  size?: number
}) {
  const pitch = useSharedValue<number | null>(-8)
  const tilt = useSharedValue(1)
  const roll = useDerivedValue<number | null>(() => tilt.value * 14)
  const yaw = useDerivedValue<number | null>(() => {
    const strength = Math.max(0, (Math.abs(tilt.value) - 0.55) / 0.45)
    return -4.5 * strength * Math.sign(tilt.value)
  })

  useEffect(() => {
    pitch.value = withRepeat(withTiming(8, { duration: 3400 }), -1, true)
    tilt.value = withRepeat(withTiming(-1, { duration: 3900 }), -1, true)
    return () => {
      cancelAnimation(pitch)
      cancelAnimation(tilt)
    }
  }, [pitch, tilt])

  return (
    <BoardAttitudeIndicator
      pitch={pitch}
      roll={roll}
      yaw={yaw}
      railId={railId}
      railColorId={railColorId}
      size={size}
    />
  )
}
