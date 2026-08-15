import { create } from 'zustand'

import {
  accentColors,
  neutralColors,
  resolveAdaptiveColor,
  type ResolvedTheme,
} from '@/constants/theme'

interface ThemeState {
  resolvedTheme: ResolvedTheme
  outdoorLight: number
  sessionOverride: ResolvedTheme | null
  setResolution: (resolvedTheme: ResolvedTheme, outdoorLight: number) => void
  setSessionOverride: (sessionOverride: ResolvedTheme | null) => void
}

export const useThemeStore = create<ThemeState>((set) => ({
  resolvedTheme: 'dark',
  outdoorLight: 0,
  sessionOverride: null,
  setResolution: (resolvedTheme, outdoorLight) => set({ resolvedTheme, outdoorLight }),
  setSessionOverride: (sessionOverride) => set({ sessionOverride }),
}))

/** String colors for renderers such as Skia/Reanimated that cannot resolve native ColorValue. */
export function useResolvedNeutralColors() {
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme)
  return neutralColors[resolvedTheme]
}

/** Plain accent strings for Mapbox, Skia, Reanimated worklets, and solid action pairs. */
export function useResolvedAccentColors() {
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme)
  return accentColors[resolvedTheme]
}

/** Resolve one adaptive token when a renderer-facing API accepts a caller-selected color. */
export function useResolvedColor(color: string): string {
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme)
  return resolveAdaptiveColor(color, resolvedTheme) as string
}
