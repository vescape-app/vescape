import type { MapPointCategory } from 'vescape-core'

import type { MapPinKind } from '@/modules/map-points/constants/mapPoints'

export function isFilterableMapPinKind(kind: MapPinKind): kind is MapPointCategory {
  return kind !== 'direction'
}

export function isMapPinKindVisible(
  kind: MapPinKind,
  hiddenCategories: readonly MapPointCategory[],
) {
  return !isFilterableMapPinKind(kind) || !hiddenCategories.includes(kind)
}

const COMPACT_MAP_POINT_CATEGORIES: readonly MapPointCategory[] = ['drop', 'bonk', 'nose_slide']

export function isCompactMapPointCategory(category: MapPointCategory) {
  return COMPACT_MAP_POINT_CATEGORIES.includes(category)
}
