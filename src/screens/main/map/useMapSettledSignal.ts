import { useCallback, useEffect, useState } from 'react'

/**
 * Mapbox gives Maestro no idle signal, so a screenshot flow would otherwise have to guess with a
 * sleep and can catch a half-drawn map. Publish the map's own idle event as a waitable marker.
 */
export function useMapSettledSignal({
  enabled,
  mode,
  onMapIdle,
}: {
  enabled: boolean
  mode: string
  onMapIdle: (...args: unknown[]) => void
}) {
  const [mapSettled, setMapSettled] = useState(false)
  useEffect(() => {
    if (enabled) setMapSettled(false)
  }, [mode, enabled])
  const handleIdle = useCallback(
    (...args: unknown[]) => {
      onMapIdle(...args)
      if (enabled) setMapSettled(true)
    },
    [enabled, onMapIdle],
  )
  return { mapSettled, handleIdle }
}
