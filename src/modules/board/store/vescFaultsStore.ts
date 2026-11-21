import { AppState } from 'react-native'
import { create } from 'zustand'
import { addVescFaultsListener, getVescFaults, type VescFaultOccurrence } from 'vescape-core'
import { omitKey } from '@/helpers/records'

export const EMPTY_FAULTS: VescFaultOccurrence[] = []

interface VescFaultsState {
  faultsByBoard: Record<string, VescFaultOccurrence[]>
  error: string | null
  replaceBoard: (boardId: string, faults: VescFaultOccurrence[]) => void
  replaceAll: (faults: VescFaultOccurrence[]) => void
  clear: () => void
}

function groupByBoard(faults: VescFaultOccurrence[]): Record<string, VescFaultOccurrence[]> {
  const byBoard: Record<string, VescFaultOccurrence[]> = {}
  for (const fault of faults) {
    ;(byBoard[fault.boardId] ??= []).push(fault)
  }
  return byBoard
}

export const useVescFaultsStore = create<VescFaultsState>((set) => ({
  faultsByBoard: {},
  error: null,
  replaceBoard: (boardId, faults) =>
    set((state) => {
      if (faults.length === 0) {
        return { faultsByBoard: omitKey(state.faultsByBoard, boardId), error: null }
      }
      return { faultsByBoard: { ...state.faultsByBoard, [boardId]: faults }, error: null }
    }),
  replaceAll: (faults) => set({ faultsByBoard: groupByBoard(faults), error: null }),
  clear: () => set({ faultsByBoard: {} }),
}))

export function startVescFaultsSync(): () => void {
  let revision = 0
  const sub = addVescFaultsListener((event) => {
    revision += 1
    useVescFaultsStore.getState().replaceBoard(event.boardId, event.faults)
  })
  const pull = () => {
    const startedAt = ++revision
    void getVescFaults()
      .then((faults) => {
        if (revision !== startedAt) return
        useVescFaultsStore.setState({ faultsByBoard: groupByBoard(faults), error: null })
      })
      .catch(() => {
        if (revision !== startedAt) return
        useVescFaultsStore.setState({ error: 'Controller faults could not be refreshed.' })
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
