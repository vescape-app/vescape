import { useEffect } from 'react'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { startDebugReplay } from 'vescape-core'

import { useBoardStore } from '@/modules/board/store/boardStore'

async function startReplay(recording: string, board?: string, warmup?: string, loop?: string) {
  if (board) useBoardStore.getState().setActiveBoard(board)
  const warmupMs = Number(warmup)
  await startDebugReplay(recording, {
    warmupMs: warmup && Number.isFinite(warmupMs) ? warmupMs : undefined,
    loop: loop === '1' || loop === 'true',
  })
  console.log(`[replay] ${recording} running`)
}

export default function ReplayLink() {
  const { recording, board, warmup, loop } = useLocalSearchParams<{
    recording: string
    board?: string
    warmup?: string
    loop?: string
  }>()
  const router = useRouter()

  useEffect(() => {
    if (__DEV__ && recording) {
      startReplay(recording, board, warmup, loop).catch((error: unknown) =>
        console.warn('[replay] failed', error),
      )
    }
    if (router.canDismiss()) router.dismissAll()
    router.replace('/')
  }, [recording, board, warmup, loop, router])

  return null
}
