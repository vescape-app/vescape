import { useEffect, useState } from 'react'
import { getVescFaultCapture, type VescFaultCaptureDetail } from 'vescape-core'

/**
 * Load the VESC Fault Capture for one occurrence, once it is asked for.
 *
 * A capture can hold thousands of decoded samples, so it is never part of the always-on fault
 * mirror — it is pulled on demand when the rider opens a fault. Native storage is durable truth and
 * a closed capture never changes, so there is nothing to subscribe to.
 */
export function useVescFaultCapture(occurrenceId: string, enabled: boolean) {
  const [capture, setCapture] = useState<VescFaultCaptureDetail | null>(null)
  const [loading, setLoading] = useState(enabled)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    setLoading(true)
    void getVescFaultCapture(occurrenceId)
      .then((result) => {
        if (cancelled) return
        setCapture(result)
      })
      // A failed read renders as "no capture"; reopening the fault retries.
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [occurrenceId, enabled])

  return { capture, loading }
}
