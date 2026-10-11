import { useSharedValue } from 'react-native-reanimated'

import { BoardAttitudeIndicator } from '@/modules/board/components/BoardAttitudeIndicator'

/** Static pose of the same model used by the live IMU indicator. */
export function BoardModelPreview({
  railId,
  railColorId,
  size,
}: {
  railId?: string
  railColorId?: string
  size: number
}) {
  const pitch = useSharedValue<number | null>(0)
  const roll = useSharedValue<number | null>(25)

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
