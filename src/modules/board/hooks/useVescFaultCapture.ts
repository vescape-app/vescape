import { useEffect, useState } from 'react'
import { getVescFaultCapture, type VescFaultCaptureDetail } from 'vescape-core'

/**
 * Load the VESC Fault Capture for one occurrence, once it is asked for.
 *
 * Samples stay out of the always-on fault mirror and load when the rider opens a fault.
 * Native writes the past snapshot once, when the occurrence opens.
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
