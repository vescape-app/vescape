import { AppState } from 'react-native'
import { create } from 'zustand'
import { addVescFaultsListener, getVescFaults, type VescFaultOccurrence } from 'vescape-core'
import { omitKey } from '@/helpers/records'

/** Stable empty slice so `faultsByBoard[id] ?? EMPTY_FAULTS` selectors don't churn references. */
export const EMPTY_FAULTS: VescFaultOccurrence[] = []

/**
 * Dumb JS mirror of the durable native VESC Fault Occurrence store. Native owns detection, the
 * occurrence lifecycle, and dismissal truth; this store only renders. Same full-slice contract as
 * `boardWarningsStore`: each `onVescFaults` emit carries the whole list for one Board and replaces
 * that board's slice wholesale.
 */
interface VescFaultsState {
  /** Occurrences keyed by boardId, newest first. A board with no faults has no entry. */
  faultsByBoard: Record<string, VescFaultOccurrence[]>
  replaceBoard: (boardId: string, faults: VescFaultOccurrence[]) => void
  /** Replace the entire mirror from a native pull — heals boards changed while away. */
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
  replaceBoard: (boardId, faults) =>
    set((state) => {
      if (faults.length === 0) {
        return { faultsByBoard: omitKey(state.faultsByBoard, boardId) }
      }
      return { faultsByBoard: { ...state.faultsByBoard, [boardId]: faults } }
    }),
  replaceAll: (faults) => set({ faultsByBoard: groupByBoard(faults) }),
  clear: () => set({ faultsByBoard: {} }),
}))

/**
 * Wire the native → JS VESC Fault mirror. Call once at app root; returns an unsubscribe.
 *
 * Two channels, exactly like `startBoardWarningsSync`: live pushes while foregrounded and listening,
 * plus a foreground catch-up pull. A fault opened during a headless ride is dropped by the frontend
 * gate, so re-reading native truth on `AppState -> active` is what makes it appear.
 */
export function startVescFaultsSync(): () => void {
  // A live push always reflects newer native truth than an in-flight pull snapshot.
  let revision = 0
  const sub = addVescFaultsListener((event) => {
    revision += 1
    useVescFaultsStore.getState().replaceBoard(event.boardId, event.faults)
  })
  const pull = () => {
    const startedAt = revision
    void getVescFaults()
      .then((faults) => {
        if (revision !== startedAt) return
        useVescFaultsStore.getState().replaceAll(faults)
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
