// Dev-only composition keeps the throwaway tune control separate from live tune mutations.
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import { useSharedValue, withTiming } from 'react-native-reanimated'
import { Text } from '@/components/base/Text'
import { BoardAttitudeIndicator } from '@/modules/board/components/BoardAttitudeIndicator'
import { useBoardStore } from '@/modules/board/store/boardStore'
import { TuneRingPrototype } from '@/modules/tune/prototype/TuneRingPrototype'

export function TuneRingPrototypeScreen() {
  'use no memo'
  const { variant: param } = useLocalSearchParams<{ variant?: string }>()
  const router = useRouter()
  const board = useBoardStore((state) =>
    state.boards.find((item) => item.id === state.activeBoardId),
  )
  const pitch = useSharedValue<number | null>(-5)
  const roll = useSharedValue<number | null>(24)
  const yaw = useSharedValue<number | null>(-12)
  const parsed = Number(param)
  const variant = Number.isInteger(parsed) && parsed >= 1 && parsed <= 6 ? parsed : 1
  if (!__DEV__) return <Text>Prototype available in development builds.</Text>
  return (
    <>
      <Stack.Screen options={{ title: 'Tune · Ring prototype' }} />
      <TuneRingPrototype
        variant={variant}
        onVariant={(next) => router.setParams({ variant: String(next) })}
        boardName={board?.name ?? 'Your Board · XR'}
        onPose={(values) => {
          pitch.set(withTiming((values[2] - values[1]) * 0.2, { duration: 400 }))
          roll.set(withTiming(15 + values[0] * 0.25, { duration: 400 }))
        }}
        board={
          <BoardAttitudeIndicator
            pitch={pitch}
            roll={roll}
            yaw={yaw}
            size={180}
            railId={board?.personalization?.railId ?? 'xr'}
            railColorId={board?.personalization?.railColorId ?? 'cyan'}
          />
        }
      />
    </>
  )
}
