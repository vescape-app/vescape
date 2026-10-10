import { useMemo } from 'react'

import { MapPin } from '@/modules/map/components/MapPin'
import { getMapPointKindIcon } from '@/modules/map-points/constants/mapPointIcons'
import {
  getMapPointKindColor,
  getMapPointKindLabel,
  getMapPointKindTextColor,
} from '@/modules/map-points/constants/mapPoints'
import { isMapPinKindVisible } from '@/modules/map-points/lib/mapPointVisibility'
import type { MainMapLayersProps } from '@/screens/main/map/mainMapLayerTypes'

/** Saved Map Points, with the one the rider tapped (or is navigating to) drawn as selected. */
export function MapPointLayers({
  mapPoints,
  hiddenMapPointCategories,
  selectedMapPointId,
  activeNavigationTarget,
  expandSelectedMapPoints,
  interactive,
  onToggleMapPointSelection,
  onSuppressNextMapPress,
}: {
  mapPoints: MainMapLayersProps['mapPoints']
  hiddenMapPointCategories: MainMapLayersProps['hiddenMapPointCategories']
  selectedMapPointId: MainMapLayersProps['selectedMapPointId']
  activeNavigationTarget: MainMapLayersProps['activeNavigationTarget']
  expandSelectedMapPoints: boolean
  interactive: boolean
  onToggleMapPointSelection: MainMapLayersProps['onToggleMapPointSelection']
  onSuppressNextMapPress: MainMapLayersProps['onSuppressNextMapPress']
}) {
  const visiblePoints = useMemo(
    () =>
      mapPoints.filter((point) => isMapPinKindVisible(point.category, hiddenMapPointCategories)),
    [hiddenMapPointCategories, mapPoints],
  )
  const activeNavigationMapPointId =
    activeNavigationTarget?.type === 'mapPoint' ? activeNavigationTarget.point.id : null
  const selectedId = visiblePoints.some((point) => point.id === selectedMapPointId)
    ? selectedMapPointId
    : null

  return (
    <>
      {visiblePoints.map((point) => (
        <MapPin
          key={point.id}
          id={`center-map-point-${point.id}`}
          coordinate={[point.longitude, point.latitude]}
          color={getMapPointKindColor(point.category)}
          icon={getMapPointKindIcon(point.category)}
          iconColor={getMapPointKindTextColor(point.category)}
          selected={selectedId === point.id || activeNavigationMapPointId === point.id}
          navigationActive={activeNavigationMapPointId === point.id}
          expandSelected={expandSelectedMapPoints && selectedId === point.id}
          label={point.name?.trim() || getMapPointKindLabel(point.category)}
          onSelected={
            interactive
              ? () => {
                  onSuppressNextMapPress()
                  onToggleMapPointSelection(point.id)
                }
              : undefined
          }
        />
      ))}
    </>
  )
}
