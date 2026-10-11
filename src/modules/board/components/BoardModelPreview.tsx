import { useSharedValue } from 'react-native-reanimated'

import { BoardAttitudeIndicator } from '@/modules/board/components/BoardAttitudeIndicator'

/** Static pose of the same model used by the live IMU indicator. */
export function BoardModelPreview({
  railId,
  railColorId,
  size,
  rollDegrees = 25,
}: {
  railId?: string
  railColorId?: string
  size: number
  rollDegrees?: number
}) {
  const pitch = useSharedValue<number | null>(0)
  const roll = useSharedValue<number | null>(rollDegrees)

  return (
    <BoardAttitudeIndicator
      pitch={pitch}
      roll={roll}
      railId={railId}
      railColorId={railColorId}
      size={size}
    />
  )
}
