import type { MapStyleKey } from '@/modules/map/constants/mapStyles'
import type { ResolvedTheme } from '@/constants/theme'

/** Appearance to persist when the rider selects a basemap. */
export function themeOverrideForMapStyle(style: MapStyleKey): ResolvedTheme | null {
  if (style === 'onedark' || style === 'satellite') return 'dark'
  if (style === 'outdoors' || style === 'mapy') return 'light'
  return null
}

/** Keep explicit day/night basemaps aligned with the configured app appearance. */
export function mapStyleForTheme(style: MapStyleKey, theme: ResolvedTheme): MapStyleKey {
  if (style !== 'onedark' && style !== 'outdoors') return style
  return theme === 'dark' ? 'onedark' : 'outdoors'
}
