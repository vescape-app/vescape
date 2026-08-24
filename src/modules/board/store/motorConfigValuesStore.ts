import { AppState } from 'react-native'
import { create } from 'zustand'
import {
  addMotorConfigValuesListener,
  getMotorConfigValues,
  type MotorConfigValues,
} from 'vescape-core'

/**
 * Dumb JS mirror of the native-owned Motor Config Values (MCCONF) for the current Board Session.
 * Native reads once per session and never writes this config at all (ADR 0036); this store renders
 * whatever it is handed, and empties on the null emit — disconnect, board switch, `mismatched` link
 * integrity, or a signature no layout carries.
 */
interface MotorConfigValuesState {
  values: MotorConfigValues | null
  replace: (values: MotorConfigValues | null) => void
}

export const useMotorConfigValuesStore = create<MotorConfigValuesState>((set) => ({
  values: null,
  replace: (values) => set({ values }),
}))

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
