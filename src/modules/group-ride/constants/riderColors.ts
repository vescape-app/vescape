import { personalizationColorOptions } from '@/constants/theme'

/**
 * Curated marker-color choices a Rider can pick from. Palette-sourced and kept
 * generic — the chosen color tints the Rider's presence wherever it is shown
 * (today: the Group Ride map markers other Riders see).
 */
export const riderColorOptions: readonly string[] = personalizationColorOptions.map(
  ({ value }) => value,
)
