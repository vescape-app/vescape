import { accentColors } from '@/constants/theme'

/**
 * Curated marker-color choices a Rider can pick from. Palette-sourced and kept
 * generic — the chosen color tints the Rider's presence wherever it is shown
 * (today: the Group Ride map markers other Riders see).
 */
export const riderColorOptions: readonly string[] = [
  accentColors.dark.sky.color,
  accentColors.dark.cyan.color,
  accentColors.dark.teal.color,
  accentColors.dark.groupRide.color,
  accentColors.dark.green.color,
  accentColors.dark.beige.color,
  accentColors.dark.yellow.color,
  accentColors.dark.amber.color,
  accentColors.dark.orange.color,
  accentColors.dark.red.color,
  accentColors.dark.pink.color,
  accentColors.dark.fuchsia.color,
  accentColors.dark.purple.color,
  accentColors.dark.violet.color,
]
