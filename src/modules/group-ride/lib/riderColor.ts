import { accentColors, theme, type ResolvedAccentColors } from '@/constants/theme'
import type { RosterRider } from '@/modules/group-ride/lib/roster'

/** Fallback tints assigned by roster index when a Rider has not picked a color. */
function riderFallbackColors(accents: ResolvedAccentColors) {
  return [
    accents.cyan.color,
    accents.green.color,
    accents.amber.color,
    accents.fuchsia.color,
    accents.sky.color,
  ]
}

/** Marker/trail tint for a Rider: their chosen color, a palette fallback, or muted when stale. */
export function rosterRiderColor(
  rider: RosterRider,
  index: number,
  accents: ResolvedAccentColors = accentColors.dark,
): string {
  const fallbackColors = riderFallbackColors(accents)
  return rider.stale
    ? theme.palette.slate.textMuted
    : (rider.color ?? fallbackColors[index % fallbackColors.length])
}
