import { accentColors, theme, type ResolvedAccentColors } from '@/constants/theme'

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/GroupRideRoster.kt `GROUP_RIDE_RIDER_COLORS`
 * @parity /modules/vescape-core/ios/watch/GroupRideRoster.swift `GROUP_RIDE_RIDER_COLORS`
 */
const RIDER_HUES = ['cyan', 'green', 'amber', 'fuchsia', 'sky'] as const

export type RiderHue = (typeof RIDER_HUES)[number]

const FNV_OFFSET_BASIS = 0x811c9dc5
const FNV_PRIME = 0x01000193

/**
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

export function riderHue(id: string): RiderHue {
  return RIDER_HUES[riderPaletteIndex(id)]
}

export function riderMapColor(
  rider: { id: string; stale: boolean },
  accents: ResolvedAccentColors = accentColors.dark,
): string {
  return rider.stale ? theme.palette.slate.textMuted : accents[riderHue(rider.id)].color
}
