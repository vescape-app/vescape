import { theme } from '@/constants/theme'

/** Shared surface for widgets whose whole body is interactive. */
export const widgetSurface = {
  backgroundColor: theme.control.background,
  borderColor: theme.control.border,
  borderWidth: 1,
  borderRadius: 18,
} as const

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
