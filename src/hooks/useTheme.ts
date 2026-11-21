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
  type ThemeColor,
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

export function useResolvedNeutralColors() {
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme)
  return neutralColors[resolvedTheme]
}

export function useResolvedControlColors() {
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme)
  return controlColors[resolvedTheme]
}

export function useResolvedAccentColors() {
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme)
  return accentColors[resolvedTheme]
}

export function useResolvedTelemetryColors() {
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme)
  return telemetryColors[resolvedTheme]
}

export function useResolvedColor(color: ThemeColor): string {
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme)
  return resolveAdaptiveColor(color, resolvedTheme)
}

export function useColoredAction(accent: ThemeColor): string {
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme)
  const accentColor = resolveAdaptiveColor(accent, resolvedTheme)
  if (resolvedTheme === 'dark') return `rgba(${hexToRgb(accentColor)},${coloredAction.darkTint})`
  return blend(controlColors.light.background, accentColor, coloredAction.tint)
}

export function useColoredActionForeground(accent: ThemeColor): string {
  return resolveAdaptiveColor(accent, 'dark')
}

function hexToRgb(hex: string): string {
  const value = hex.replace('#', '')
  const [r, g, b] =
    value.length === 3
      ? value.split('').map((c) => Number.parseInt(c + c, 16))
      : [0, 2, 4].map((i) => Number.parseInt(value.slice(i, i + 2), 16))
  return `${r},${g},${b}`
}
