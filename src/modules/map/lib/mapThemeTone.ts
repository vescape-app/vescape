import type { ResolvedTheme } from '@/constants/theme'

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export interface MapThemeTone {
  imageryOpacity: number
  imagerySaturation: number
  imageryContrast: number
  roadLineOpacity: number
}

/** Reconciles manual satellite controls with a gradual daylight/theme adjustment. */
export function resolveMapThemeTone({
  theme,
  outdoorLight,
  imageryOpacity,
  imagerySaturation,
}: {
  theme: ResolvedTheme
  outdoorLight: number
  imageryOpacity: number
  imagerySaturation: number
}): MapThemeTone {
  const daylight = clamp(outdoorLight, 0, 1)
  const lightTheme = theme === 'light'
  const saturationAdjustment = lightTheme ? -0.03 : -0.35 + daylight * 0.2
  const themedImageryOpacity = lightTheme
    ? 0.32 + imageryOpacity * 0.64
    : imageryOpacity * (0.55 + daylight * 0.2)

  return {
    imageryOpacity: clamp(themedImageryOpacity, 0.1, 1),
    imagerySaturation: clamp(imagerySaturation + saturationAdjustment, -1, 1),
    imageryContrast: lightTheme ? -0.02 : -0.3 + daylight * 0.08,
    roadLineOpacity: lightTheme ? 0.75 : 0.45 + daylight * 0.2,
  }
}
