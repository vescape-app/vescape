import { create } from 'zustand'
import {
  getRefloatConfigSnapshot as nativeGetRefloatConfigSnapshot,
  type RefloatConfigSnapshot,
} from 'vescape-core'

import { errorMessage } from '@/helpers/error'
import {
  canRunFirmwareCommand,
  firmwareCommandBlockedMessage,
} from '@/modules/board/lib/boardLinkIntegrity'
import { useBleStore } from '@/modules/board/store/bleStore'

type TuneSnapshotStatus = 'idle' | 'loading' | 'ready' | 'error'

interface TuneSnapshotState {
  status: TuneSnapshotStatus
  snapshot: RefloatConfigSnapshot | null
  error: string | null
}

interface TuneSnapshotActions {
  read: () => Promise<RefloatConfigSnapshot | null>
  setSnapshot: (snapshot: RefloatConfigSnapshot | null) => void
  clear: () => void
}
let readInFlight: Promise<RefloatConfigSnapshot | null> | null = null
let generation = 0

export const useTuneSnapshotStore = create<TuneSnapshotState & TuneSnapshotActions>((set) => ({
  status: 'idle',
  snapshot: null,
  error: null,

  read() {
    if (readInFlight) return readInFlight
    const linkIntegrity = useBleStore.getState().linkIntegrity
    if (!canRunFirmwareCommand(linkIntegrity)) {
      const message = firmwareCommandBlockedMessage(linkIntegrity)
      set({ status: 'error', snapshot: null, error: message })
      return Promise.resolve(null)
    }

    const readGeneration = ++generation
    // Deliberately keeps whatever is already displayed: a re-read of the same config must not blink
    // the screen back to a loading state, and a prefill has to survive the read starting.
    set({ status: 'loading', error: null })
    readInFlight = nativeGetRefloatConfigSnapshot()
      .then((snapshot) => {
        if (readGeneration === generation) {
          set((state) => ({
            status: 'ready',
            // Same raw config as what is on screen -> keep the object, so nothing downstream
            // recomputes. A differing hash is a plain refresh, not a diff prompt.
            snapshot:
              state.snapshot?.rawConfigHash === snapshot.rawConfigHash ? state.snapshot : snapshot,
            error: null,
          }))
        }
        return snapshot
      })
      .catch((error: unknown) => {
        if (readGeneration === generation) {
          set({
            status: 'error',
            snapshot: null,
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

  setSnapshot(snapshot) {
    generation += 1
    readInFlight = null
    set({
      status: snapshot ? 'ready' : 'idle',
      snapshot,
      error: null,
    })
  },

  clear() {
    generation += 1
    readInFlight = null
    set({ status: 'idle', snapshot: null, error: null })
  },
}))
