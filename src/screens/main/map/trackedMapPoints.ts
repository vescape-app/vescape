import { CrosshairSimpleIcon, type Icon } from 'phosphor-react-native'
import { createElement } from 'react'
import { View } from 'react-native'
import type { MapPoint } from 'vescape-core'

import type { DirectionPoint } from '@/modules/map/store/mapStore'
import type { RosterRider } from '@/modules/group-ride/lib/roster'
import type { MapSelection } from '@/modules/map/lib/mapSelection'
import type { ResolvedAccentColors } from '@/constants/theme'
import { rosterRiderColor } from '@/modules/group-ride/lib/riderColor'
import {
  getMapPointKindIcon,
  getPlaceCategoryIcon,
} from '@/modules/map-points/constants/mapPointIcons'
import {
  getMapPointKindColor,
  getMapPointKindTextColor,
} from '@/modules/map-points/constants/mapPoints'

import {
  DESTINATION_POINT_COLOR,
  DESTINATION_POINT_TEXT_COLOR,
  GPS_POINT_COLOR,
  type TrackedMapPoint,
} from '@/screens/main/map/offscreenMapIndicators'

// Filled dot matching the rider's map marker, so the edge indicator reads as that rider.
// Module scope keeps the reference stable for the indicator identity check.
const RiderDotIcon: Icon = ({ color }) =>
  createElement(View, { style: { width: 16, height: 16, borderRadius: 8, backgroundColor: color } })

export function buildGpsTrackedPoint(
  coordinate: { longitude: number; latitude: number } | null,
  riderColor: string | null,
  accents?: ResolvedAccentColors,
): TrackedMapPoint[] {
  if (!coordinate) return []
  const color = riderColor ?? accents?.purple.color ?? GPS_POINT_COLOR
  return [
    {
      id: 'gps',
      type: 'gps',
      coordinate: [coordinate.longitude, coordinate.latitude],
      color,
      textColor: color,
      icon: CrosshairSimpleIcon,
    },
  ]
}

export function buildMapPointTrackedPoint(
  point: MapPoint,
  id: string,
  accents?: ResolvedAccentColors,
): TrackedMapPoint {
  return {
    id,
    type: 'mapPoint',
    coordinate: [point.longitude, point.latitude],
    color: getMapPointKindColor(point.category, accents),
    textColor: getMapPointKindTextColor(point.category, accents),
    icon: getMapPointKindIcon(point.category),
  }
}

function directionTrackedPoint(
  coordinate: [number, number],
  riderColor: string | null,
  accents?: ResolvedAccentColors,
  icon = getMapPointKindIcon('direction'),
): TrackedMapPoint {
  return {
    id: 'direction',
    type: 'direction',
    coordinate,
    color: riderColor ?? accents?.green.color ?? DESTINATION_POINT_COLOR,
    textColor: riderColor ?? accents?.green.text ?? DESTINATION_POINT_TEXT_COLOR,
    icon,
  }
}

export function buildActiveNavigationPoint({
  activeNavigationTarget,
  directionPoint,
  mapPoints,
  riderColor,
  accents,
}: {
  activeNavigationTarget: MapSelection | null
  directionPoint: DirectionPoint | null
  mapPoints: MapPoint[]
  riderColor: string | null
  accents?: ResolvedAccentColors
}): TrackedMapPoint | null {
  if (!activeNavigationTarget) {
    if (!directionPoint) return null
    return directionTrackedPoint(
      [directionPoint.longitude, directionPoint.latitude],
      riderColor,
      accents,
    )
  }
  if (activeNavigationTarget.type === 'mapPoint') {
    const point =
      mapPoints.find((candidate) => candidate.id === activeNavigationTarget.id) ??
      activeNavigationTarget.point
    return buildMapPointTrackedPoint(point, `navigation-map-point-${point.id}`, accents)
  }
  return directionTrackedPoint(
    [activeNavigationTarget.longitude, activeNavigationTarget.latitude],
    riderColor,
    accents,
    activeNavigationTarget.type === 'place'
      ? getPlaceCategoryIcon(activeNavigationTarget.category)
      : undefined,
  )
}

/** Peers themselves, index-aligned with the roster so pin and edge indicator share one tint. */
export function buildRiderPoints(
  riders: RosterRider[],
  accents?: ResolvedAccentColors,
): TrackedMapPoint[] {
  return riders.flatMap((rider, index) => {
    const presence = rider.presence
    if (!presence) return []
    const color = rosterRiderColor(rider, index, accents)
    return [
      {
        id: `rider-${rider.id}`,
        type: 'rider' as const,
        coordinate: [presence.lng, presence.lat] as [number, number],
        color,
        textColor: color,
        icon: RiderDotIcon,
      },
    ]
  })
}

/** Peers' shared targets, same index-aligned tint as their rider pin. */
export function buildRiderTargetPoints(
  riders: RosterRider[],
  accents?: ResolvedAccentColors,
): TrackedMapPoint[] {
  return riders.flatMap((rider, index) => {
    const target = rider.presence?.target
    if (!target) return []
    const color = rosterRiderColor(rider, index, accents)
    return [
      {
        id: `rider-target-${rider.id}`,
        type: 'riderTarget' as const,
        coordinate: [target.lng, target.lat] as [number, number],
        color,
        textColor: color,
        icon: getMapPointKindIcon('direction'),
      },
    ]
  })
}
