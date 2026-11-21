import type { MapStyleKey } from '@/modules/map/constants/mapStyles'
import type { ResolvedTheme } from '@/constants/theme'

export function mapStyleForTheme(style: MapStyleKey, theme: ResolvedTheme): MapStyleKey {
  if (style !== 'onedark' && style !== 'outdoors') return style
  return theme === 'dark' ? 'onedark' : 'outdoors'
}
