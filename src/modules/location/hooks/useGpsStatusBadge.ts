import { useEffect, useState } from 'react'

import { deriveGpsStatusBadge, type GpsStatusBadge } from '@/modules/location/lib/gpsStatusBadge'
import { useLocationStore } from '@/modules/location/store/locationStore'

const AGE_TICK_MS = 5_000

export function useGpsStatusBadge(enabled = true): GpsStatusBadge | null {
  const phase = useLocationStore((s) => s.gpsStatus)
  const latestFix = useLocationStore((s) => s.latestApproximateLocation)
  const [nowMs, setNowMs] = useState(() => Date.now())

  const ticking = enabled && phase === 'active' && latestFix !== null
  useEffect(() => {
    if (!ticking) return
    const id = setInterval(() => setNowMs(Date.now()), AGE_TICK_MS)
    return () => clearInterval(id)
  }, [ticking])

  if (!enabled) return null
  return deriveGpsStatusBadge({ phase, latestFix, nowMs })
}
