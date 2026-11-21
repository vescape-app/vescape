import { useCallback, useEffect, useState } from 'react'

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
