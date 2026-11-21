import { AppState } from 'react-native'
import { create } from 'zustand'
import { addBoardWarningsListener, getBoardWarnings, type BoardWarning } from 'vescape-core'
import { omitKey } from '@/helpers/records'

export const EMPTY_WARNINGS: BoardWarning[] = []

interface BoardWarningsState {
  warningsByBoard: Record<string, BoardWarning[]>
  error: string | null
  replaceBoard: (boardId: string, warnings: BoardWarning[]) => void
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
  error: null,
  replaceBoard: (boardId, warnings) =>
    set((state) => {
      if (warnings.length === 0) {
        return { warningsByBoard: omitKey(state.warningsByBoard, boardId), error: null }
      }
      return { warningsByBoard: { ...state.warningsByBoard, [boardId]: warnings }, error: null }
    }),
  replaceAll: (warnings) => set({ warningsByBoard: groupByBoard(warnings), error: null }),
  clear: () => set({ warningsByBoard: {} }),
}))

export function startBoardWarningsSync(): () => void {
  let revision = 0
  const sub = addBoardWarningsListener((event) => {
    revision += 1
    useBoardWarningsStore.getState().replaceBoard(event.boardId, event.warnings)
  })
  const pull = () => {
    const startedAt = ++revision
    void getBoardWarnings()
      .then((warnings) => {
        if (revision !== startedAt) return
        useBoardWarningsStore.setState({ warningsByBoard: groupByBoard(warnings), error: null })
      })
      .catch(() => {
        if (revision !== startedAt) return
        useBoardWarningsStore.setState({ error: 'Board warnings could not be refreshed.' })
      })
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
