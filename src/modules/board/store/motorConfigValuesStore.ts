import { useEffect } from 'react'
import { AppState } from 'react-native'
import { create } from 'zustand'
import {
  addMotorConfigValuesListener,
  getLastKnownMotorConfigValues,
  getMotorConfigValues,
  type MotorConfigValues,
} from 'vescape-core'
import { useBoardStore } from '@/modules/board/store/boardStore'

/**
 * Dumb JS mirror of the native-owned Motor Config Values (MCCONF) for the current Board Session.
 * Native reads once per session and never writes this config at all (ADR 0036); this store renders
 * whatever it is handed, and empties on the null emit — disconnect, board switch, `mismatched` link
 * integrity, or a signature no layout carries.
 */
interface MotorConfigValuesState {
  values: MotorConfigValues | null
  /** The durable copy for one Board, loaded on demand for readers that outlive the Board Session. */
  lastKnown: MotorConfigValues | null
  replace: (values: MotorConfigValues | null) => void
  loadLastKnown: (boardId: string) => Promise<void>
}

export const useMotorConfigValuesStore = create<MotorConfigValuesState>((set, get) => ({
  values: null,
  lastKnown: null,
  replace: (values) => set({ values }),
  loadLastKnown: async (boardId) => {
    if (get().lastKnown?.boardId === boardId) return
    try {
      const values = await getLastKnownMotorConfigValues(boardId)
      // A Board switch mid-flight must not land the wrong Board's values.
      if (values == null || values.boardId === boardId) set({ lastKnown: values })
    } catch {
      // Nothing to show is the same outcome as a failed load; the next mount retries.
    }
  },
}))

/**
 * This Board's motor config as a reader should see it: the live session values, or the durable Last
 * Known copy while the Board is off.
 */
export function useMotorConfigFields(): MotorConfigValues | null {
  const values = useMotorConfigValuesStore((s) => s.values)
  const lastKnown = useMotorConfigValuesStore((s) => s.lastKnown)
  const boardId = useBoardStore((s) => s.activeBoardId)
  const loadLastKnown = useMotorConfigValuesStore((s) => s.loadLastKnown)

  useEffect(() => {
    if (values == null && boardId != null) void loadLastKnown(boardId)
  }, [values, boardId, loadLastKnown])

  if (values != null) return values
  return lastKnown?.boardId === boardId ? lastKnown : null
}

/**
 * Wire the native → JS Motor Config Values mirror. Call once at app root; returns an unsubscribe.
 *
 * Same two channels as `startBoardConfigValuesSync`: live pushes while foregrounded and listening,
 * plus a pull on mount and on every foreground, because emits are dropped while backgrounded and a
 * whole Board Session can start and end in that window.
 */
export function startMotorConfigValuesSync(): () => void {
  // A live push always reflects newer native truth than an in-flight pull; drop a pull whose result
  // resolved after one landed.
  let revision = 0
  const sub = addMotorConfigValuesListener((event) => {
    revision += 1
    useMotorConfigValuesStore.getState().replace(event.values)
  })
  const pull = () => {
    const startedAt = revision
    void getMotorConfigValues()
      .then((values) => {
        if (revision !== startedAt) return
        useMotorConfigValuesStore.getState().replace(values)
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
