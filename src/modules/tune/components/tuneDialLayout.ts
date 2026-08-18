export const DIAL_HEIGHT = 105
export const TOP_VALUE_BAND_HEIGHT = 22
export const MAJOR_TICK_TOP = TOP_VALUE_BAND_HEIGHT + 5
export const RULER_LABEL_BAND_TOP = 76
const VALUE_LABEL_HEIGHT = 14
export const CURRENT_VALUE_TOP = 2
export const GLOW_WIDTH = 52
export const LABEL_FONT_SIZE = 9
export const BADGE_FONT_SIZE = 18
export const BADGE_WIDTH = 80
export const BADGE_BASELINE = 17
export const LABEL_BASELINE_Y =
  RULER_LABEL_BAND_TOP + (VALUE_LABEL_HEIGHT + LABEL_FONT_SIZE) / 2 - 1.5

/** Snap-to-step spring, shared by the drag settle and the external value sync. */
export const SNAP_SPRING = { damping: 18, stiffness: 700, mass: 0.8 }

export function formatDisplayValue(value: number, decimals: number): string {
  'worklet'

  if (decimals <= 0) return String(Math.round(value))
  return value.toFixed(decimals)
}
