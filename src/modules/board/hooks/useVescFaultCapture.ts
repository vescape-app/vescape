import { useEffect, useState } from 'react'
import { getVescFaultCapture, type VescFaultCaptureDetail } from 'vescape-core'

export function useVescFaultCapture(occurrenceId: string, enabled: boolean) {
  const [capture, setCapture] = useState<VescFaultCaptureDetail | null>(null)
  const [loading, setLoading] = useState(enabled)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    setLoading(true)
    setError(null)
    void getVescFaultCapture(occurrenceId)
      .then((result) => {
        if (cancelled) return
        setCapture(result)
      })
      .catch(() => {
        if (!cancelled) setError('Telemetry capture could not be loaded.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [occurrenceId, enabled])

  return { capture, loading, error }
}
