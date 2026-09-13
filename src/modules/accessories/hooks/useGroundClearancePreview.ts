import { useEffect, useState } from 'react'
import { AppState } from 'react-native'
import {
  addAccessoryReadingListener,
  setAccessoryPreview,
  type AccessoryReadingEvent,
} from 'vescape-core'

/** The newest sample native accepted, or null before one has arrived in this session. */
export type LiveReading = Pick<AccessoryReadingEvent, 'status' | 'valueCm' | 'seq'> | null

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
 * The last sample is dropped whenever demand is released. It described the ground under a board at
 * a moment that has passed, and showing it again on return would be a stale number presented as a
 * live one.
 */
export function useGroundClearancePreview(
  accessoryId: string,
  capabilityId: string | undefined,
): LiveReading {
  const [reading, setReading] = useState<LiveReading>(null)

  useEffect(() => {
    if (!capabilityId) return
    let open = false

    const demand = (next: boolean) => {
      if (next === open) return
      open = next
      setAccessoryPreview(accessoryId, capabilityId, next)
      if (!next) setReading(null)
    }

    const subscription = addAccessoryReadingListener((event) => {
      if (event.accessoryId !== accessoryId || event.capabilityId !== capabilityId) return
      setReading({ status: event.status, valueCm: event.valueCm, seq: event.seq })
    })
    const appState = AppState.addEventListener('change', (status) => {
      demand(status === 'active')
    })

    demand(AppState.currentState === 'active')

    return () => {
      subscription.remove()
      appState.remove()
      demand(false)
    }
  }, [accessoryId, capabilityId])

  return reading
}
