import { AppState } from 'react-native'
import { create } from 'zustand'
import { addBoardWarningsListener, getBoardWarnings, type BoardWarning } from 'vescape-core'
import { omitKey } from '@/helpers/records'

/** Stable empty slice so `warningsByBoard[id] ?? EMPTY_WARNINGS` selectors don't churn references. */
export const EMPTY_WARNINGS: BoardWarning[] = []

/**
 * Dumb JS mirror of the durable native Board Warning registry. Native owns detection and truth; this
 * store only renders. Each `onBoardWarnings` emit carries the full warning list for one Board, and we
 * replace that board's slice wholesale (never merge) so JS state exactly tracks native state — the
 * event fires on every registry change and on subscribe, so a late subscriber is immediately
 * consistent.
 */
interface BoardWarningsState {
  /** Warnings keyed by boardId. A board with no warnings has no entry. */
  warningsByBoard: Record<string, BoardWarning[]>
  replaceBoard: (boardId: string, warnings: BoardWarning[]) => void
  /** Replace the entire mirror from a native pull — heals boards whose warnings cleared while away. */
  replaceAll: (warnings: BoardWarning[]) => void
  clear: () => void
}

function groupByBoard(warnings: BoardWarning[]): Record<string, BoardWarning[]> {
  const byBoard: Record<string, BoardWarning[]> = {}
  for (const warning of warnings) {
    ;(byBoard[warning.boardId] ??= []).push(warning)
  }
  return byBoard
}

export const useBoardWarningsStore = create<BoardWarningsState>((set) => ({
  warningsByBoard: {},
  replaceBoard: (boardId, warnings) =>
    set((state) => {
      if (warnings.length === 0) {
        return { warningsByBoard: omitKey(state.warningsByBoard, boardId) }
      }
      return { warningsByBoard: { ...state.warningsByBoard, [boardId]: warnings } }
    }),
  replaceAll: (warnings) => set({ warningsByBoard: groupByBoard(warnings) }),
  clear: () => set({ warningsByBoard: {} }),
}))

/**
 * Wire the native → JS Board Warning mirror. Call once at app root; returns an unsubscribe.
 *
 * Two channels, mirroring `startAppDataSync`:
 * - **Push:** live `onBoardWarnings` emits while JS is foregrounded and listening. Native replays a
 *   per-board snapshot on subscribe, so a fresh listener starts consistent.
 * - **Pull:** a foreground catch-up. Emits are dropped while the app is backgrounded (`frontendActive`
 *   gates the native firehose), so a warning fired or auto-cleared during a headless ride would be
 *   lost. Re-reading native truth on `AppState -> active` and replacing the whole store heals both a
 *   new warning and a warning that cleared while away.
 */
export function startBoardWarningsSync(): () => void {
  // A live push always reflects newer native truth than an in-flight pull snapshot. Bump a revision on
  // every push and capture it when a pull starts; if a push landed while the async read was resolving,
  // drop the now-stale `replaceAll` instead of clobbering the fresher per-board state.
  let revision = 0
  const sub = addBoardWarningsListener((event) => {
    revision += 1
    useBoardWarningsStore.getState().replaceBoard(event.boardId, event.warnings)
  })
  const pull = () => {
    const startedAt = revision
    void getBoardWarnings()
      .then((warnings) => {
        if (revision !== startedAt) return
        useBoardWarningsStore.getState().replaceAll(warnings)
      })
      // A failed pull keeps the last known mirror; the next foreground or push heals it.
      .catch(() => undefined)
  }
  pull()
  const appStateSub = AppState.addEventListener('change', (nextState) => {
    if (nextState === 'active') pull()
  })
  return () => {
    sub.remove()
    appStateSub.remove()
  }
}
