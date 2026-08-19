import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  dismissAlternativeHint,
  switchToAlternativeBoard,
  type PresenceObservation,
} from 'vescape-core'
import { useShallow } from 'zustand/react/shallow'

import { nextAlternativeHint } from '@/modules/board/lib/alternativeHints'
import { useBleStore } from '@/modules/board/store/bleStore'
import { useBoardStore } from '@/modules/board/store/boardStore'

/** How often the queue re-checks expiry. Native prunes too; this only paces the rider's view. */
const EXPIRY_TICK_MS = 1_000

export interface AlternativeHintState {
  /** The single Board offered right now, or `null` when the queue is empty. */
  hint: PresenceObservation | null
  /** Local acknowledgement: reveals the next queued Board and creates no Automatic Connection Pause. */
  dismiss: () => void
  /** Full explicit Connect on the offered Board — pause clear plus durable Connect Intent. */
  switchAndConnect: () => void
}

/**
 * Advisory switch-and-connect hints (ADR 0035, #408).
 *
 * Native reports linked non-selected Boards from their advertisements alone and never connects
 * them. This hook turns that queue into exactly one offer at a time, in discovery order.
 *
 * Dismissal is deliberately JS-local and session-scoped: it is an acknowledgement of *this* offer,
 * not a suppression rule, so it survives nothing and suppresses nothing.
 */
export function useAlternativeHint(): AlternativeHintState {
  const { observations, status } = useBleStore(
    useShallow((s) => ({ observations: s.presence.observations, status: s.status })),
  )
  const activeBoardId = useBoardStore((s) => s.activeBoardId)
  const [dismissedBoardIds, setDismissedBoardIds] = useState<string[]>([])
  const [now, setNow] = useState(() => Date.now())
  const switching = useRef(false)

  // A live Board Session outranks every hint, so a connection clears the whole queue.
  const connectedBoardId = status === 'connected' || status === 'stale' ? activeBoardId : null

  // Observations age out on a clock, not on a native event, so the queue needs its own pulse — but
  // only while there is something that could expire.
  const ticking = observations.length > 0 && !connectedBoardId
  useEffect(() => {
    if (!ticking) return
    const id = setInterval(() => setNow(Date.now()), EXPIRY_TICK_MS)
    return () => clearInterval(id)
  }, [ticking])

  // Forget acknowledgements for Boards that are no longer being offered, so a Board that rides back
  // into range half an hour later gets a fresh offer rather than silence.
  useEffect(() => {
    setDismissedBoardIds((previous) => {
      const live = previous.filter((id) => observations.some((o) => o.boardId === id))
      return live.length === previous.length ? previous : live
    })
  }, [observations])

  const hint = useMemo(
    () =>
      nextAlternativeHint({
        observations,
        selectedBoardId: activeBoardId,
        connectedBoardId,
        dismissedBoardIds,
        now,
      }),
    [observations, activeBoardId, connectedBoardId, dismissedBoardIds, now],
  )

  const dismiss = useCallback(() => {
    if (!hint) return
    dismissAlternativeHint(hint.boardId)
    setDismissedBoardIds((previous) =>
      previous.includes(hint.boardId) ? previous : [...previous, hint.boardId],
    )
  }, [hint])

  const switchAndConnect = useCallback(() => {
    if (!hint || switching.current) return
    switching.current = true
    const boardId = hint.boardId
    // Durable selection first, so JS and native agree on the Board before the session starts.
    // `switchToAlternativeBoard` is the explicit-Connect path: it clears *this* Board's pause and
    // takes durable Connect Intent ownership, exactly like the Connect pill.
    useBoardStore.getState().setActiveBoard(boardId)
    void switchToAlternativeBoard(boardId).finally(() => {
      switching.current = false
    })
  }, [hint])

  return { hint, dismiss, switchAndConnect }
}
