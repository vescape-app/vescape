import type { MapPointCategory } from 'vescape-core'

import { theme, type ResolvedAccentColors } from '@/constants/theme'

/**
 * What a pin on the map can be: a server Map Point category, or the rider's own direction target.
 * Presentation only — the direction target is not a Map Point and never reaches the server.
 */
export type MapPinKind = MapPointCategory | 'direction'

/**
 * Photo/video attachment for a Map Point. Off: the server owns Map Points and its version one has
 * no media, so nothing captured here could reach another rider. The capture UI is kept behind this
 * flag until the server can store media.
 */
export const MAP_POINT_MEDIA_ENABLED = false

type MapPointThemeKey = 'sky' | 'green' | 'purple' | 'amber' | 'red' | 'yellow' | 'cyan'

interface MapPinAppearance {
  label: string
  themeKey: MapPointThemeKey
}

export interface MapPointCategoryOption extends MapPinAppearance {
  kind: MapPointCategory
}

/** Categories a rider can place and filter. The direction target is neither, so it is not here. */
export const MAP_POINT_CATEGORY_OPTIONS: readonly MapPointCategoryOption[] = [
  { kind: 'drop', label: 'Drop', themeKey: 'sky' },
  { kind: 'bonk', label: 'Bonk', themeKey: 'amber' },
  { kind: 'nose_slide', label: 'Nose slide', themeKey: 'purple' },
  { kind: 'trail_entry', label: 'Trail entry', themeKey: 'cyan' },
  { kind: 'viewpoint', label: 'Viewpoint', themeKey: 'yellow' },
  { kind: 'charging', label: 'Charging', themeKey: 'cyan' },
] as const

const DIRECTION_PIN: MapPinAppearance = { label: 'Direction point', themeKey: 'green' }

const APPEARANCE_BY_KIND = new Map<MapPinKind, MapPinAppearance>([
  ...MAP_POINT_CATEGORY_OPTIONS.map(
    (option) => [option.kind, option] as [MapPinKind, MapPinAppearance],
  ),
  ['direction', DIRECTION_PIN],
])

function appearance(kind: MapPinKind): MapPinAppearance {
  return APPEARANCE_BY_KIND.get(kind) ?? MAP_POINT_CATEGORY_OPTIONS[0]
}

export function getMapPointKindColor(kind: MapPinKind, accents?: ResolvedAccentColors) {
  const themeKey = appearance(kind).themeKey
  return accents?.[themeKey].color ?? theme.palette[themeKey].color
}

export function getMapPointKindTextColor(kind: MapPinKind, accents?: ResolvedAccentColors) {
  const themeKey = appearance(kind).themeKey
  return accents?.[themeKey].text ?? theme.palette[themeKey].text
}

export function getMapPointKindLabel(kind: MapPinKind) {
  return appearance(kind).label
}
