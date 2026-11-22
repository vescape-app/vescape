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

interface MotorConfigValuesState {
  values: MotorConfigValues | null
  lastKnown: MotorConfigValues | null
  error: string | null
  replace: (values: MotorConfigValues | null) => void
  loadLastKnown: (boardId: string) => Promise<void>
}
let lastKnownLoadGeneration = 0

export const useMotorConfigValuesStore = create<MotorConfigValuesState>((set, get) => ({
  values: null,
  lastKnown: null,
  error: null,
  replace: (values) => set({ values, error: null }),
  loadLastKnown: async (boardId) => {
    if (get().lastKnown?.boardId === boardId) return
    const request = ++lastKnownLoadGeneration
    try {
      const values = await getLastKnownMotorConfigValues(boardId)
      if (request === lastKnownLoadGeneration) set({ lastKnown: values, error: null })
    } catch {
      if (request === lastKnownLoadGeneration)
        set({ error: 'Saved motor configuration could not be read.' })
    }
  },
}))

export function useMotorConfigFields(requestedBoardId?: string): MotorConfigValues | null {
  const values = useMotorConfigValuesStore((s) => s.values)
  const lastKnown = useMotorConfigValuesStore((s) => s.lastKnown)
  const activeBoardId = useBoardStore((s) => s.activeBoardId)
  const boardId = requestedBoardId ?? activeBoardId
  const loadLastKnown = useMotorConfigValuesStore((s) => s.loadLastKnown)

  const sessionValues =
    values && (values.boardId == null || values.boardId === boardId) ? values : null

  useEffect(() => {
    if (sessionValues == null && boardId != null) void loadLastKnown(boardId)
  }, [sessionValues, boardId, loadLastKnown])

  if (sessionValues != null) return sessionValues
  return lastKnown?.boardId === boardId ? lastKnown : null
}

export function startMotorConfigValuesSync(): () => void {
  let revision = 0
  const sub = addMotorConfigValuesListener((event) => {
    revision += 1
    useMotorConfigValuesStore.getState().replace(event.values)
  })
  const pull = () => {
    const startedAt = ++revision
    void getMotorConfigValues()
      .then((values) => {
        if (revision !== startedAt) return
        useMotorConfigValuesStore.setState({ values, error: null })
      })
      .catch(() => {
        if (revision !== startedAt) return
        useMotorConfigValuesStore.setState({ error: 'Motor configuration could not be refreshed.' })
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
