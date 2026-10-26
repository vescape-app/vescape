import { useEffect, useState, type ReactNode } from 'react'
import { Appearance, useColorScheme } from 'react-native'

import {
  isUsableThemeCoordinate,
  outdoorLightProgress,
  resolveThemeMode,
} from '@/modules/settings/lib/themeMode'
import { useSunThemeClock } from '@/modules/settings/hooks/useSunThemeClock'
import { useSettingsStore } from '@/modules/settings/store/settingsStore'
import { useThemeStore } from '@/hooks/useTheme'

/**
 * Applies the rider's theme, and only then mounts the app. Static styles resolve adaptive colours
 * when their views are created, so a screen mounted before the scheme is set (a cold deep link)
 * keeps the system appearance, not the rider's.
 */
export function ThemeController({ children }: { children: ReactNode }) {
  const systemTheme = useColorScheme()
  const settingsRead = useSettingsStore((state) => state.loaded || state.loadError != null)
  const [applied, setApplied] = useState(false)
  const mode = useSettingsStore((state) => state.themeMode)
  const setResolution = useThemeStore((state) => state.setResolution)
  const { coordinate, now } = useSunThemeClock()

  const resolvedTheme = resolveThemeMode({
    mode,
    systemTheme: systemTheme === 'light' || systemTheme === 'dark' ? systemTheme : null,
    date: now,
    coordinate,
  })
  const outdoorLight = isUsableThemeCoordinate(coordinate)
    ? outdoorLightProgress(now, coordinate)
    : resolvedTheme === 'light'
      ? 1
      : 0
  const followsSystem =
    mode === 'system' || (mode === 'sun' && !isUsableThemeCoordinate(coordinate))

  useEffect(() => {
    if (!settingsRead) return
    setResolution(resolvedTheme, outdoorLight)
    Appearance.setColorScheme(followsSystem ? 'unspecified' : resolvedTheme)
    // The app mounts only once the native scheme is set, which happens here and not in render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setApplied(true)
  }, [followsSystem, outdoorLight, resolvedTheme, setResolution, settingsRead])

  return applied ? children : null
}
