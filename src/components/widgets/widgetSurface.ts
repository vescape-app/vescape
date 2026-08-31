import { theme } from '@/constants/theme'
import { useResolvedNeutralColors } from '@/hooks/useTheme'

/**
 * Shared surface for widgets whose whole body is interactive. Safe as a static style: every
 * `control` token holds the same value in both appearances, so nothing here can resolve to the
 * wrong theme. Give a `control` color diverging dark/light values and it stops being safe.
 */
export const widgetSurface = {
  backgroundColor: theme.control.background,
  borderColor: theme.control.border,
  borderWidth: 1,
  borderRadius: 18,
} as const

/**
 * Large, secondary navigation rows used inside sheets and settings lists. Deliberately not
 * exported: its `neutral` colors differ per appearance, and baked into a module-scope
 * `StyleSheet` they resolve against the OS appearance instead of the rider's chosen theme.
 * Callers take `useResolvedSecondaryWidgetSurface()` so the app theme is the only input.
 */
const secondaryWidgetSurface = {
  backgroundColor: theme.neutral.surfaceDeep,
  borderColor: theme.neutral.border,
  borderWidth: 1,
  borderRadius: 18,
} as const

/**
 * Resolved strings for the secondary surface. iOS view properties can retain a previous
 * `DynamicColorIOS` value when the app changes its forced appearance, and a static `StyleSheet`
 * never regenerates — so the border read as light-theme slate over a dark drawer. Reading the
 * theme store makes the rider's choice the single source of truth on both platforms.
 */
export function useResolvedSecondaryWidgetSurface() {
  const neutral = useResolvedNeutralColors()
  return {
    ...secondaryWidgetSurface,
    backgroundColor: neutral.surfaceDeep,
    borderColor: neutral.border,
  }
}

/** Flat canvas for read-only widgets; actions inside it provide their own interaction surface. */
export const presentationWidgetSurface = {
  backgroundColor: theme.alpha(theme.palette.mono.black, 0),
  borderColor: theme.alpha(theme.palette.mono.black, 0),
  borderWidth: 0,
  borderRadius: 0,
} as const

/**
 * Footprint a widget occupies in the 4-column widget grid:
 *   - `square` → 1×1 icon tile (aspect-1)
 *   - `half`   → 1×2 compact row
 *   - `full`   → 1×4 full-width row (default)
 */
export type WidgetSize = 'square' | 'half' | 'full'
