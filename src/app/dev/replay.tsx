import { useEffect } from 'react'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { startDebugReplay } from 'vescape-core'

import { useBoardStore } from '@/modules/board/store/boardStore'

async function startReplay(recording: string, board?: string, warmup?: string, loop?: string) {
  // A replay runs as the selected Board, so a named one is selected first, as a rider's pick would.
  if (board) useBoardStore.getState().setActiveBoard(board)
  const warmupMs = Number(warmup)
  await startDebugReplay(recording, {
    warmupMs: warmup && Number.isFinite(warmupMs) ? warmupMs : undefined,
    loop: loop === '1' || loop === 'true',
  })
  console.log(`[replay] ${recording} running`)
}

/**
 * Dev-only deep link that starts a Debug Recording replay:
 * `vescape://dev/replay?recording=<name>&board=<boardId>&warmup=<ms>&loop=1`. Only `recording` is
 * required. Release builds ignore it.
 */
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
