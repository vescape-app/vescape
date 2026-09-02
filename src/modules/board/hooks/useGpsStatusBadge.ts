import { useEffect, useState } from 'react'

import { deriveGpsStatusBadge, type GpsStatusBadge } from '@/modules/board/lib/gpsStatusBadge'
import { useBleStore } from '@/modules/board/store/bleStore'

/**
 * Fast enough that "GPS signal lost" appears close to the 30 s window it describes, slow enough to
 * stay invisible in a render profile.
 */
const AGE_TICK_MS = 5_000

/**
 * What is wrong with GPS right now, or `null` while it is healthy. Phase is native's answer; only
 * the age of the latest fix has to be recomputed here, and only while one exists to go stale.
 */
export function useGpsStatusBadge(enabled = true): GpsStatusBadge | null {
  const phase = useBleStore((s) => s.gpsStatus)
  // Freshness beats precision for "is GPS delivering": the approximate fix is always the newest one.
  const latestFix = useBleStore((s) => s.latestApproximateLocation)
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
