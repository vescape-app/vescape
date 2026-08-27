import { useEffect, useMemo, useState } from 'react'
import { Appearance, useColorScheme } from 'react-native'

import {
  isUsableThemeCoordinate,
  outdoorLightProgress,
  resolveThemeMode,
} from '@/modules/settings/lib/themeMode'
import { useSettingsStore } from '@/modules/settings/store/settingsStore'
import { useThemeStore } from '@/hooks/useTheme'

const THEME_CLOCK_INTERVAL_MS = 60_000

export function ThemeController() {
  const systemTheme = useColorScheme()
  const mode = useSettingsStore((state) => state.themeMode)
  const latitude = useSettingsStore((state) => state.lastGpsLatitude)
  const longitude = useSettingsStore((state) => state.lastGpsLongitude)
  const sessionOverride = useThemeStore((state) => state.sessionOverride)
  const setResolution = useThemeStore((state) => state.setResolution)
  const [now, setNow] = useState(() => new Date())
  const coordinate = useMemo(
    () => ({ latitude: latitude ?? Number.NaN, longitude: longitude ?? Number.NaN }),
    [latitude, longitude],
  )

  useEffect(() => {
    if (mode !== 'sun') return
    const timer = setInterval(() => setNow(new Date()), THEME_CLOCK_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [mode])

  const resolvedTheme = resolveThemeMode({
    mode,
    systemTheme: systemTheme === 'light' || systemTheme === 'dark' ? systemTheme : null,
    date: now,
    coordinate,
    sessionOverride,
  })
  const outdoorLight = isUsableThemeCoordinate(coordinate)
    ? outdoorLightProgress(now, coordinate)
    : resolvedTheme === 'light'
      ? 1
      : 0
  const followsSystem =
    sessionOverride == null &&
    (mode === 'system' || (mode === 'sun' && !isUsableThemeCoordinate(coordinate)))

  useEffect(() => {
    setResolution(resolvedTheme, outdoorLight)
    Appearance.setColorScheme(followsSystem ? 'unspecified' : resolvedTheme)
  }, [followsSystem, outdoorLight, resolvedTheme, setResolution])

  return null
}
