import type { MapStyleKey } from '@/modules/map/constants/mapStyles'
import type { ResolvedTheme } from '@/constants/theme'

/** Only basemaps with an explicit appearance temporarily override the app theme. */
export function themeOverrideForMapStyle(style: MapStyleKey): ResolvedTheme | null {
  if (style === 'onedark') return 'dark'
  if (style === 'outdoors') return 'light'
  return null
}

/** Keep explicit day/night basemaps aligned with the configured app appearance. */
export function mapStyleForTheme(style: MapStyleKey, theme: ResolvedTheme): MapStyleKey {
  if (style !== 'onedark' && style !== 'outdoors') return style
  return theme === 'dark' ? 'onedark' : 'outdoors'
}
