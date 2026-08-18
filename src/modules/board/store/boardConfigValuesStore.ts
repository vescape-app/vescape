import { AppState } from 'react-native'
import { create } from 'zustand'
import {
  addBoardConfigValuesListener,
  getBoardConfigValues,
  type BoardConfigValues,
} from 'vescape-core'

/**
 * Refloat footpad ADC switch voltages — the reading each zone disengages below. `0` means the switch
 * is disabled for that zone; the `footpad-disabled` Board Warning covers both being `0`.
 * @parity /modules/vescape-core/ios/warnings/ConfigSafetyDetector.swift `faultAdc1Id`
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/warnings/ConfigSafetyDetector.kt `FAULT_ADC1_ID`
 */
const FAULT_ADC_IDS = ['fault_adc1', 'fault_adc2'] as const

/**
 * What the footpad dots used before real config was reachable, kept as the no-values fallback.
 * Config changes rarely and the gap before the read lands is seconds, so the UI falls back silently
 * rather than showing a loading state.
 */
export const FOOTPAD_FALLBACK_THRESHOLD_V = 0.8

/**
 * Dumb JS mirror of the native-owned Board Config Values for the current Board Session. Native reads
 * once after link trust and refreshes only on its own config writes (ADR 0035); this store just
 * renders whatever it is handed, and empties on the null emit (disconnect, board switch,
 * `mismatched`).
 *
 * Provisional and fresh values are indistinguishable here on purpose — the distinction gates writes,
 * not display.
 */
interface BoardConfigValuesState {
  values: BoardConfigValues | null
  replace: (values: BoardConfigValues | null) => void
}

export const useBoardConfigValuesStore = create<BoardConfigValuesState>((set) => ({
  values: null,
  replace: (values) => set({ values }),
}))

/** A decoded config field as a finite number, or null when absent, unparseable, or a bool. */
function configNumber(values: BoardConfigValues | null, id: string): number | null {
  const raw = values?.values[id]
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null
}

/**
 * The footpad engagement threshold for one zone, in ADC volts.
 *
 * `null` means no config is available — callers fall back to {@link FOOTPAD_FALLBACK_THRESHOLD_V}.
 * `0` means the rider disabled that zone's switch: it never engages, and nothing should be drawn
 * for it.
 */
export function useFootpadThreshold(zone: 0 | 1): number | null {
  return useBoardConfigValuesStore((s) => configNumber(s.values, FAULT_ADC_IDS[zone]))
}

/**
 * Wire the native → JS Board Config Values mirror. Call once at app root; returns an unsubscribe.
 *
 * Same two channels as `startBoardWarningsSync`: live pushes while foregrounded and listening, plus
 * a pull on mount and on every foreground, because emits are dropped while backgrounded and a whole
 * Board Session can start and end in that window.
 */
export function startBoardConfigValuesSync(): () => void {
  // A live push always reflects newer native truth than an in-flight pull; drop a pull whose result
  // resolved after one landed.
  let revision = 0
  const sub = addBoardConfigValuesListener((event) => {
    revision += 1
    useBoardConfigValuesStore.getState().replace(event.values)
  })
  const pull = () => {
    const startedAt = revision
    void getBoardConfigValues()
      .then((values) => {
        if (revision !== startedAt) return
        useBoardConfigValuesStore.getState().replace(values)
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
