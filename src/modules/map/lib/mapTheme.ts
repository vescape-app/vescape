import type { MapStyleKey } from '@/modules/map/constants/mapStyles'
import type { ResolvedTheme } from '@/constants/theme'

/** Resolve the rendered variant without changing the saved map preference. */
export function mapStyleForTheme(style: MapStyleKey, theme: ResolvedTheme): MapStyleKey {
  if (style !== 'onedark' && style !== 'outdoors') return style
  return theme === 'dark' ? 'onedark' : 'outdoors'
}
