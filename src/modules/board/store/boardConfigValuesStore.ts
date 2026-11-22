import { useEffect } from 'react'
import { AppState } from 'react-native'
import { create } from 'zustand'
import {
  addBoardConfigValuesListener,
  getBoardConfigValues,
  getLastKnownBoardConfigValues,
  type BoardConfigValues,
} from 'vescape-core'
import { useBoardStore } from '@/modules/board/store/boardStore'

/**
 * @parity /modules/vescape-core/ios/warnings/ConfigSafetyDetector.swift `faultAdc1Id`
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/warnings/ConfigSafetyDetector.kt `FAULT_ADC1_ID`
 */
const FAULT_ADC_IDS = ['fault_adc1', 'fault_adc2'] as const

export const FOOTPAD_FALLBACK_THRESHOLD_V = 0.8

interface BoardConfigValuesState {
  values: BoardConfigValues | null
  lastKnown: BoardConfigValues | null
  error: string | null
  replace: (values: BoardConfigValues | null) => void
  loadLastKnown: (boardId: string) => Promise<void>
}
let lastKnownLoadGeneration = 0

export const useBoardConfigValuesStore = create<BoardConfigValuesState>((set, get) => ({
  values: null,
  lastKnown: null,
  error: null,
  replace: (values) => set({ values, error: null }),
  loadLastKnown: async (boardId) => {
    if (get().lastKnown?.boardId === boardId) return
    const request = ++lastKnownLoadGeneration
    try {
      const values = await getLastKnownBoardConfigValues(boardId)
      if (request === lastKnownLoadGeneration) set({ lastKnown: values, error: null })
    } catch {
      if (request === lastKnownLoadGeneration)
        set({ error: 'Saved board configuration could not be read.' })
    }
  },
}))

export function useBoardConfigFields(requestedBoardId?: string): BoardConfigValues | null {
  const values = useBoardConfigValuesStore((s) => s.values)
  const lastKnown = useBoardConfigValuesStore((s) => s.lastKnown)
  const activeBoardId = useBoardStore((s) => s.activeBoardId)
  const boardId = requestedBoardId ?? activeBoardId
  const loadLastKnown = useBoardConfigValuesStore((s) => s.loadLastKnown)

  const sessionValues =
    values && (values.boardId == null || values.boardId === boardId) ? values : null

  useEffect(() => {
    if (sessionValues == null && boardId != null) void loadLastKnown(boardId)
  }, [sessionValues, boardId, loadLastKnown])

  if (sessionValues != null) return sessionValues
  return lastKnown?.boardId === boardId ? lastKnown : null
}

function configNumber(values: BoardConfigValues | null, id: string): number | null {
  const raw = values?.values[id]
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null
}

export function usePosiSensor(): boolean {
  const values = useBoardConfigFields()
  const raw = values?.values.fault_is_dual_switch
  return typeof raw === 'number' ? raw !== 0 : raw === true
}

export function useFootpadThreshold(zone: 0 | 1): number | null {
  return useBoardConfigValuesStore((s) => configNumber(s.values, FAULT_ADC_IDS[zone]))
}

export function startBoardConfigValuesSync(): () => void {
  let revision = 0
  const sub = addBoardConfigValuesListener((event) => {
    revision += 1
    useBoardConfigValuesStore.getState().replace(event.values)
  })
  const pull = () => {
    const startedAt = ++revision
    void getBoardConfigValues()
      .then((values) => {
        if (revision !== startedAt) return
        useBoardConfigValuesStore.setState({ values, error: null })
      })
      .catch(() => {
        if (revision !== startedAt) return
        useBoardConfigValuesStore.setState({ error: 'Board configuration could not be refreshed.' })
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
