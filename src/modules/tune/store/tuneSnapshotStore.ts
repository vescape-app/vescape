import { create } from 'zustand'
import {
  refreshBoardConfigValues as nativeRefreshBoardConfigValues,
  type BoardConfigValues,
} from 'vescape-core'

import { errorMessage } from '@/helpers/error'
import {
  canRunFirmwareCommand,
  firmwareCommandBlockedMessage,
} from '@/modules/board/lib/boardLinkIntegrity'
import { useBleStore } from '@/modules/board/store/bleStore'
import { useBoardConfigValuesStore } from '@/modules/board/store/boardConfigValuesStore'
import { useTuneProfileStore } from '@/modules/tune/store/tuneProfileStore'

type TuneSnapshotStatus = 'idle' | 'loading' | 'ready' | 'error'

interface TuneSnapshotState {
  status: TuneSnapshotStatus
  boardConfig: BoardConfigValues | null
  error: string | null
}

interface TuneSnapshotActions {
  read: () => Promise<BoardConfigValues | null>
  setBoardConfig: (boardConfig: BoardConfigValues | null) => void
  clear: () => void
}
let readInFlight: Promise<BoardConfigValues | null> | null = null
let generation = 0

export const useTuneSnapshotStore = create<TuneSnapshotState & TuneSnapshotActions>((set) => ({
  status: 'idle',
  boardConfig: null,
  error: null,

  read() {
    if (readInFlight) return readInFlight
    const linkIntegrity = useBleStore.getState().linkIntegrity
    if (!canRunFirmwareCommand(linkIntegrity)) {
      const message = firmwareCommandBlockedMessage(linkIntegrity)
      set({ status: 'error', boardConfig: null, error: message })
      return Promise.resolve(null)
    }

    const readGeneration = ++generation
    set({ status: 'loading', error: null })
    readInFlight = nativeRefreshBoardConfigValues()
      .then((boardConfig) => {
        if (readGeneration === generation) {
          useBoardConfigValuesStore.getState().replace(boardConfig)
          set({
            status: 'ready',
            boardConfig,
            error: null,
          })
        }
        return boardConfig
      })
      .catch((error: unknown) => {
        if (readGeneration === generation) {
          set({
            status: 'error',
            boardConfig: null,
            error: errorMessage(error, 'Unable to read Refloat config.'),
          })
        }
        return null
      })
      .finally(() => {
        if (readGeneration === generation) {
          readInFlight = null
        }
      })

    return readInFlight
  },

  setBoardConfig(boardConfig) {
    generation += 1
    readInFlight = null
    set({
      status: boardConfig ? 'ready' : 'idle',
      boardConfig,
      error: null,
    })
  },

  clear() {
    generation += 1
    readInFlight = null
    set({ status: 'idle', boardConfig: null, error: null })
  },
}))

export function startTuneSnapshotSessionSync(): () => void {
  return useBoardConfigValuesStore.subscribe((state, previous) => {
    if (previous.values && !state.values) useTuneSnapshotStore.getState().clear()
    const prevSchema = previous.values?.schema ?? previous.lastKnown?.schema ?? null
    const nextSchema = state.values?.schema ?? state.lastKnown?.schema ?? null
    if (prevSchema !== nextSchema) {
      useTuneProfileStore.getState().recomputeForSchema()
    }
  })
}
