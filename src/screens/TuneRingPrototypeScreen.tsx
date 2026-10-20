// Dev-only composition keeps the throwaway tune control separate from live tune mutations.
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import { useSharedValue } from 'react-native-reanimated'
import { Text } from '@/components/base/Text'
import { BoardAttitudeIndicator } from '@/modules/board/components/BoardAttitudeIndicator'
import { useBoardStore } from '@/modules/board/store/boardStore'
import { TuneRingWorkspace } from '@/modules/tune/prototype/TuneRingWorkspace'
import { TuneRingPrototype } from '@/modules/tune/prototype/TuneRingPrototype'

export function TuneRingPrototypeScreen() {
  'use no memo'
  const { variant: param } = useLocalSearchParams<{ variant?: string }>()
  const router = useRouter()
  const board = useBoardStore((state) =>
    state.boards.find((item) => item.id === state.activeBoardId),
  )
  const liveValues = useSharedValue([55, 45, 60, 50])
  const pitch = useSharedValue<number | null>(0)
  const roll = useSharedValue<number | null>(0)
  const yaw = useSharedValue<number | null>(0)
  const parsed = Number(param)
  const variant = Number.isInteger(parsed) && parsed >= 1 && parsed <= 6 ? parsed : 1
  if (!__DEV__) return <Text>Prototype available in development builds.</Text>
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      {variant === 6 ? (
        <TuneRingWorkspace onVariant={(next) => router.setParams({ variant: String(next) })} />
      ) : (
        <TuneRingPrototype
          variant={variant}
          onVariant={(next) => router.setParams({ variant: String(next) })}
          liveValues={liveValues}
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
      )}
    </>
  )
}
