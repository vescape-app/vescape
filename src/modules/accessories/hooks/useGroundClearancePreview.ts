import { useEffect, useRef, useState } from 'react'
import { useSharedValue, type SharedValue } from 'react-native-reanimated'
import { AppState } from 'react-native'
import {
  addAccessoryReadingListener,
  setAccessoryPreview,
  type AccessoryReadingEvent,
  type ClearancePreviewDiagnostics,
} from 'vescape-core'

export type LiveReading = Pick<AccessoryReadingEvent, 'status' | 'valueCm' | 'seq'> | null

export interface GroundClearancePreview {
  reading: LiveReading
  liveValue: SharedValue<number>
  tiltPreviewPercent: SharedValue<number>
  diagnostics: ClearancePreviewDiagnostics | null
  stalled: boolean
}

export function useGroundClearancePreview(
  accessoryId: string,
  capabilityId: string | undefined,
): GroundClearancePreview {
  const liveValue = useSharedValue(Number.NaN)
  const tiltPreviewPercent = useSharedValue(Number.NaN)
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
        clearExpiry()
        liveValue.value = Number.NaN
        tiltPreviewPercent.value = Number.NaN
        setDiagnostics(null)
        setReading(null)
        setStalled(false)
      }
    }

    const subscription = addAccessoryReadingListener((event) => {
      if (event.accessoryId !== accessoryId || event.capabilityId !== capabilityId) return
      liveValue.value = event.status === 'ok' ? (event.valueCm ?? Number.NaN) : Number.NaN
      tiltPreviewPercent.value =
        event.status === 'ok' ? (event.tiltPreviewPercent ?? Number.NaN) : Number.NaN
      if (event.diagnostics) {
        setDiagnostics(event.diagnostics)
        setReading({ status: event.status, valueCm: event.valueCm, seq: event.seq })
      }
      setStalled(false)
      clearExpiry()
      expiry.current = setTimeout(() => {
        expiry.current = null
        liveValue.value = Number.NaN
        tiltPreviewPercent.value = Number.NaN
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
  }, [accessoryId, capabilityId, liveValue, tiltPreviewPercent])

  return { reading, stalled, liveValue, tiltPreviewPercent, diagnostics }
}
