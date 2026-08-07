import { useEffect } from 'react'

import { useThemeStore } from '@/hooks/useTheme'
import { mapStyleForTheme } from '@/modules/map/lib/mapTheme'
import { useSettingsStore } from '@/modules/settings/store/settingsStore'

/** Root-level coordination for the map and settings bounded contexts. */
export function MapThemeCoordinator() {
  const settingsLoaded = useSettingsStore((state) => state.loaded)
  const mapStyleKey = useSettingsStore((state) => state.mapStyleKey)
  const setSetting = useSettingsStore((state) => state.set)
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme)
  const sessionOverride = useThemeStore((state) => state.sessionOverride)

  useEffect(() => {
    if (!settingsLoaded || sessionOverride != null) return
    const nextMapStyle = mapStyleForTheme(mapStyleKey, resolvedTheme)
    if (nextMapStyle === mapStyleKey) return
    void setSetting('mapStyleKey', nextMapStyle)
  }, [mapStyleKey, resolvedTheme, sessionOverride, setSetting, settingsLoaded])

  return null
}
