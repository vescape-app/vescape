import { useEffect, useRef, useState } from 'react'
import { useSharedValue, type SharedValue } from 'react-native-reanimated'
import { AppState } from 'react-native'
import {
  addAccessoryReadingListener,
  setAccessoryPreview,
  type AccessoryReadingEvent,
  type ClearancePreviewDiagnostics,
} from 'vescape-core'

/** The newest sample native accepted, or null when there is not one to show. */
export type LiveReading = Pick<AccessoryReadingEvent, 'status' | 'valueCm' | 'seq'> | null

export interface GroundClearancePreview {
  /** Null before the first sample, and again once the stream goes quiet. */
  reading: LiveReading
  liveValue: SharedValue<number>
  diagnostics: ClearancePreviewDiagnostics | null
  /**
   * A sample arrived and then the stream stopped.
   *
   * Distinct from "no sample yet": the accessory answered once and has gone silent, which is a
   * different sentence for the rider and a different thing to check.
   */
  stalled: boolean
}

/**
 * Holds a measurement preview open for one capability, and reports what arrives.
 *
 * Preview demand is a *request to measure*, not a subscription: native takes the union of this and
 * the rider actually riding a calibrated board, and stops the sensor's continuous measurement when
 * neither holds. Which is why this releases on three separate exits and not just one —
 *
 * - the screen unmounting, the obvious one;
 * - the app leaving the foreground, because a screen the rider cannot see is not a screen they are
 *   reading numbers off, and leaving the sensor running would burn accessory battery in a pocket;
 * - an accessory id or capability changing under the hook, which releases the previous pair before
 *   asking for the new one.
 *
 * A displayed reading also expires on its own. `staleAfterMs` rides along with every sample — it is
 * native's window, from the rate the accessory confirmed — and when it elapses with nothing new the
 * number is dropped rather than left on screen. A frozen distance presented as a live one is the
 * same lie as an invalid reading shown as the maximum range, just slower.
 */
export function useGroundClearancePreview(
  accessoryId: string,
  capabilityId: string | undefined,
): GroundClearancePreview {
  const liveValue = useSharedValue(Number.NaN)
  const [diagnostics, setDiagnostics] = useState<ClearancePreviewDiagnostics | null>(null)
  const [reading, setReading] = useState<LiveReading>(null)
  const [stalled, setStalled] = useState(false)
  const expiry = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!capabilityId) return
    let open = false

    const clearExpiry = () => {
      if (expiry.current) clearTimeout(expiry.current)
      expiry.current = null
    }

    const demand = (next: boolean) => {
      if (next === open) return
      open = next
      setAccessoryPreview(accessoryId, capabilityId, next)
      if (!next) {
        // Released: the last sample described the ground under a board at a moment that has passed,
        // and it is not stale either — nothing is being measured at all.
        clearExpiry()
        liveValue.value = Number.NaN
        setDiagnostics(null)
        setReading(null)
        setStalled(false)
      }
    }

    const subscription = addAccessoryReadingListener((event) => {
      if (event.accessoryId !== accessoryId || event.capabilityId !== capabilityId) return
      liveValue.value = event.status === 'ok' ? (event.valueCm ?? Number.NaN) : Number.NaN
      if (event.diagnostics) {
        setDiagnostics(event.diagnostics)
        setReading({ status: event.status, valueCm: event.valueCm, seq: event.seq })
      }
      setStalled(false)
      clearExpiry()
      expiry.current = setTimeout(() => {
        expiry.current = null
        liveValue.value = Number.NaN
        setReading(null)
        setStalled(true)
      }, event.staleAfterMs)
    })
    const appState = AppState.addEventListener('change', (status) => {
      demand(status === 'active')
    })

    demand(AppState.currentState === 'active')

    return () => {
      subscription.remove()
      appState.remove()
      demand(false)
      clearExpiry()
    }
  }, [accessoryId, capabilityId, liveValue])

  return { reading, stalled, liveValue, diagnostics }
}
