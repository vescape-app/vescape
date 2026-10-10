import { AppState } from 'react-native'
import { create } from 'zustand'
import {
  addBoardConfigChangeNoticeListener,
  dismissBoardConfigChangeNotice,
  getBoardConfigChangeNotice,
  type BoardConfigChangeNotice,
} from 'vescape-core'

interface State {
  notice: BoardConfigChangeNotice | null
  load: (boardId: string | null) => Promise<void>
  dismiss: () => Promise<void>
}

let loadGeneration = 0

export const useBoardConfigChangeNoticeStore = create<State>((set, get) => ({
  notice: null,
  async load(boardId) {
    const generation = ++loadGeneration
    if (!boardId) {
      set({ notice: null })
      return
    }
    const notice = await getBoardConfigChangeNotice(boardId)
    if (generation === loadGeneration && useBoardStore.getState().activeBoardId === boardId)
      set({ notice })
  },
  async dismiss() {
    const notice = get().notice
    if (!notice) return
    loadGeneration += 1
    set({ notice: null })
    await dismissBoardConfigChangeNotice(notice.boardId)
  },
}))

export function startBoardConfigChangeNoticeSync(): () => void {
  const pull = () =>
    void useBoardConfigChangeNoticeStore.getState().load(useBoardStore.getState().activeBoardId)
  const noticeSub = addBoardConfigChangeNoticeListener(({ notice }) => {
    const active = useBoardStore.getState().activeBoardId
    if (notice === null) {
      pull()
    } else if (notice.boardId === active) {
      loadGeneration += 1
      useBoardConfigChangeNoticeStore.setState({ notice })
    }
  })
  const boardSub = useBoardStore.subscribe((state, previous) => {
    if (state.activeBoardId !== previous.activeBoardId) pull()
  })
  const appSub = AppState.addEventListener('change', (state) => {
    if (state === 'active') pull()
  })
  pull()
  return () => {
    noticeSub.remove()
    boardSub()
    appSub.remove()
  }
}

import { useBoardStore } from '@/modules/board/store/boardStore'
