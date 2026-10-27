import { useEffect, useMemo, useState } from 'react'

import type { ThemeCoordinate } from '@/modules/settings/lib/themeMode'
import { useSettingsStore } from '@/modules/settings/store/settingsStore'

const SUN_CLOCK_INTERVAL_MS = 60_000

/** Last known coordinate and a clock that ticks each minute while the `sun` theme mode is on. */
export function useSunThemeClock(): { coordinate: ThemeCoordinate; now: Date } {
  const mode = useSettingsStore((state) => state.themeMode)
  const latitude = useSettingsStore((state) => state.lastGpsLatitude)
  const longitude = useSettingsStore((state) => state.lastGpsLongitude)
  const [now, setNow] = useState(() => new Date())
  const coordinate = useMemo(
    () => ({ latitude: latitude ?? Number.NaN, longitude: longitude ?? Number.NaN }),
    [latitude, longitude],
  )

  useEffect(() => {
    if (mode !== 'sun') return
    const timer = setInterval(() => setNow(new Date()), SUN_CLOCK_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [mode])

  return { coordinate, now }
}
