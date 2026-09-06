import { create } from 'zustand'

import {
  accentColors,
  blend,
  coloredAction,
  controlColors,
  neutralColors,
  resolveAdaptiveColor,
  telemetryColors,
  type ResolvedTheme,
} from '@/constants/theme'

interface ThemeState {
  resolvedTheme: ResolvedTheme
  outdoorLight: number
  setResolution: (resolvedTheme: ResolvedTheme, outdoorLight: number) => void
}

export const useThemeStore = create<ThemeState>((set) => ({
  resolvedTheme: 'dark',
  outdoorLight: 0,
  setResolution: (resolvedTheme, outdoorLight) => set({ resolvedTheme, outdoorLight }),
}))

/** String colors for renderers such as Skia/Reanimated that cannot resolve native ColorValue. */
export function useResolvedNeutralColors() {
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme)
  return neutralColors[resolvedTheme]
}

/** Plain interaction colors for renderers and native props that reject adaptive color objects. */
export function useResolvedControlColors() {
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme)
  return controlColors[resolvedTheme]
}

/** Plain accent strings for Mapbox, Skia, Reanimated worklets, and solid action pairs. */
export function useResolvedAccentColors() {
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme)
  return accentColors[resolvedTheme]
}

/** Plain metric colors for Skia, Mapbox, Reanimated worklets, and chart data structures. */
export function useResolvedTelemetryColors() {
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme)
  return telemetryColors[resolvedTheme]
}

/** Resolve one adaptive token when a renderer-facing API accepts a caller-selected color. */
export function useResolvedColor(color: string): string {
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme)
  return resolveAdaptiveColor(color, resolvedTheme) as string
}

/**
 * Background of a colored-action button (trash, Ride it, accent/tune/success/destructive, tonal
 * circles, map-sheet delete/save/vote, group-ride CTA). On dark the accent tints the surface beneath
 * at `coloredAction.darkTint` (dev's tinted pill); on light the accent washes over the navy control
 * surface — navy + accent at `coloredAction.tint`, the "two-layer" look. Both collapse into one
 * computed color (same pixels, no palette addition). Pass the accent as a resolved hex or adaptive
 * token.
 */
export function useColoredAction(accent: string): string {
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme)
  const accentColor = resolveAdaptiveColor(accent, resolvedTheme) as string
  if (resolvedTheme === 'dark') return `rgba(${hexToRgb(accentColor)},${coloredAction.darkTint})`
  return blend(controlColors.light.background, accentColor, coloredAction.tint)
}

/**
 * Foreground (label, icon, border) of a colored-action button. The colored-action surface is navy
 * in both themes, so the accent must keep its dark-theme tone on light as well — the light-theme
 * tone is tuned for a light surface and disappears against the navy wash.
 */
export function useColoredActionForeground(accent: string): string {
  return resolveAdaptiveColor(accent, 'dark') as string
}

function hexToRgb(hex: string): string {
  const value = hex.replace('#', '')
  const [r, g, b] =
    value.length === 3
      ? value.split('').map((c) => Number.parseInt(c + c, 16))
      : [0, 2, 4].map((i) => Number.parseInt(value.slice(i, i + 2), 16))
  return `${r},${g},${b}`
}
