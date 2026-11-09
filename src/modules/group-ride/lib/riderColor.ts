import { accentColors, theme, type ResolvedAccentColors } from '@/constants/theme'

/**
 * The Rider palette, in slot order. A Rider id owns one slot for the whole ride, on every device
 * and on the wrist; the watch carries the same slots as fixed dark ARGB values.
 *
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/GroupRideRoster.kt `GROUP_RIDE_RIDER_COLORS`
 * @parity /modules/vescape-core/ios/watch/GroupRideRoster.swift `GROUP_RIDE_RIDER_COLORS`
 */
const RIDER_HUES = ['cyan', 'green', 'amber', 'fuchsia', 'sky'] as const

export type RiderHue = (typeof RIDER_HUES)[number]

const FNV_OFFSET_BASIS = 0x811c9dc5
const FNV_PRIME = 0x01000193

/**
 * The palette slot a Rider id owns: FNV-1a 32-bit over the id's UTF-8 bytes, modulo the palette
 * size. Depends on the id alone, so roster order, distance, stale and away never move it.
 *
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/GroupRideRoster.kt `groupRideRiderPaletteIndex`
 * @parity /modules/vescape-core/ios/watch/GroupRideRoster.swift `groupRideRiderPaletteIndex`
 */
export function riderPaletteIndex(id: string): number {
  let hash = FNV_OFFSET_BASIS
  for (const byte of new TextEncoder().encode(id)) {
    hash = Math.imul(hash ^ byte, FNV_PRIME)
  }
  return (hash >>> 0) % RIDER_HUES.length
}

/** The accent hue a Rider id owns, for React Native styles (`theme.palette[hue]`). */
export function riderHue(id: string): RiderHue {
  return RIDER_HUES[riderPaletteIndex(id)]
}

/**
 * Plain-string tint for a Rider's map pin, trail and target. A stale (or away) Rider draws muted;
 * muting never changes which slot the Rider owns.
 */
export function riderMapColor(
  rider: { id: string; stale: boolean },
  accents: ResolvedAccentColors = accentColors.dark,
): string {
  return rider.stale ? theme.palette.slate.textMuted : accents[riderHue(rider.id)].color
}
