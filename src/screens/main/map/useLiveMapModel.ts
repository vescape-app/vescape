import { useEffect, useMemo, useRef, useState } from 'react'
import type { LocationEvent, MapPoint, MapPointCategory } from 'vescape-core'

import { useGroupRideStore } from '@/modules/group-ride/store/groupRideStore'
import { useRiderStore } from '@/modules/group-ride/store/riderStore'
import { getLiveGpsPresentation } from '@/helpers/liveGpsPresentation'
import { makeCircleFeature, makeTrailLineString } from '@/helpers/mapGeometry'
import type { HistoryGpsSample } from '@/modules/history/store/historyStore'
import type { MapSelection } from '@/modules/map/lib/mapSelection'
import type { DirectionPoint } from '@/modules/map/store/mapStore'
import { isMapPinKindVisible } from '@/modules/map-points/lib/mapPointVisibility'
import {
  buildActiveNavigationPoint,
  buildGpsTrackedPoint,
  buildMapPointTrackedPoint,
  buildRiderPoints,
  buildRiderTargetPoints,
} from '@/screens/main/map/trackedMapPoints'
import { useResolvedAccentColors } from '@/hooks/useTheme'

/**
 * Grid the offscreen indicators are tracked on: about a metre.
 *
 * They point at things far enough away to be off screen, so a fix that moved by centimetres cannot
 * change where the arrow points — but it does rebuild the tracked-point list and everything derived
 * from it, once per fix, forever. Snapping to a metre keeps the arrows honest and the work rare.
 */
const TRACKING_GRID_DEG = 1e-5

function usableCoordinate(location: { longitude: number; latitude: number } | null | undefined) {
  if (!location) return null
  if (!Number.isFinite(location.longitude) || !Number.isFinite(location.latitude)) return null
  return {
    longitude: Math.round(location.longitude / TRACKING_GRID_DEG) * TRACKING_GRID_DEG,
    latitude: Math.round(location.latitude / TRACKING_GRID_DEG) * TRACKING_GRID_DEG,
  }
}

export function useLiveMapModel({
  liveLocations,
  latestApproximateLocation,
  historyGpsSamples,
  mapPoints,
  selectedMapPointId,
  hiddenMapPointCategories,
  activeNavigationTarget,
  directionPoint,
}: {
  liveLocations: LocationEvent[]
  latestApproximateLocation: LocationEvent | null
  historyGpsSamples: HistoryGpsSample[]
  mapPoints: MapPoint[]
  selectedMapPointId: string | null
  hiddenMapPointCategories: MapPointCategory[]
  activeNavigationTarget: MapSelection | null
  directionPoint: DirectionPoint | null
}) {
  const accents = useResolvedAccentColors()
  const [initialApproximateFix, setInitialApproximateFix] = useState<LocationEvent | null>(null)
  const gpsFix = liveLocations.at(-1) ?? null
  const gpsPresentation = useMemo(
    () =>
      getLiveGpsPresentation({
        preciseFix: gpsFix,
        latestApproximateFix: latestApproximateLocation,
        initialApproximateFix,
      }),
    [gpsFix, initialApproximateFix, latestApproximateLocation],
  )
  const { cameraFix, accuracyFix, accuracyRadiusM, directionBearingDeg } = gpsPresentation
  const approximateGpsPuckActive =
    gpsPresentation.degraded ||
    (gpsFix == null && (latestApproximateLocation != null || initialApproximateFix != null))
  const trackingCoordinate =
    usableCoordinate(gpsFix) ??
    usableCoordinate(latestApproximateLocation) ??
    usableCoordinate(initialApproximateFix) ??
    usableCoordinate(accuracyFix) ??
    usableCoordinate(cameraFix)
  // Held by value, not by identity: a fix per second would otherwise hand every consumer a new
  // object describing the same metre of pavement.
  const trackedCoordinateRef = useRef(trackingCoordinate)
  if (
    trackedCoordinateRef.current?.latitude !== trackingCoordinate?.latitude ||
    trackedCoordinateRef.current?.longitude !== trackingCoordinate?.longitude
  ) {
    trackedCoordinateRef.current = trackingCoordinate
  }
  const offscreenMapGpsCoordinate = trackedCoordinateRef.current
  const selectedMapPoint = useMemo(
    () =>
      mapPoints.find(
        (point) =>
          point.id === selectedMapPointId &&
          isMapPinKindVisible(point.category, hiddenMapPointCategories),
      ) ?? null,
    [hiddenMapPointCategories, mapPoints, selectedMapPointId],
  )
  const riderColor = useRiderStore((state) => state.riderColor)
  const riderFocusRows = useGroupRideStore((state) => state.rosterRows)
  const mapRiders = useMemo(() => riderFocusRows.filter((row) => !row.isSelf), [riderFocusRows])
  const riderTargetPoints = useMemo(
    () => buildRiderTargetPoints(mapRiders, accents),
    [accents, mapRiders],
  )
  const riderPoints = useMemo(() => buildRiderPoints(mapRiders, accents), [accents, mapRiders])
  const activeNavigationPoint = useMemo(
    () =>
      buildActiveNavigationPoint({
        activeNavigationTarget,
        directionPoint,
        mapPoints,
        riderColor,
        accents,
      }),
    [accents, activeNavigationTarget, directionPoint, mapPoints, riderColor],
  )
  const trackedMapPoints = useMemo(
    () => [
      ...buildGpsTrackedPoint(offscreenMapGpsCoordinate, riderColor, accents),
      ...(activeNavigationPoint ? [activeNavigationPoint] : []),
      ...(selectedMapPoint &&
      activeNavigationPoint?.id !== `navigation-map-point-${selectedMapPoint.id}`
        ? [buildMapPointTrackedPoint(selectedMapPoint, `map-point-${selectedMapPoint.id}`, accents)]
        : []),
      ...riderTargetPoints,
      ...riderPoints,
    ],
    [
      activeNavigationPoint,
      accents,
      offscreenMapGpsCoordinate,
      riderColor,
      riderPoints,
      riderTargetPoints,
      selectedMapPoint,
    ],
  )
  const rideRoute = useMemo(
    () => historyGpsSamples.map((point) => [point.longitude, point.latitude] as [number, number]),
    [historyGpsSamples],
  )
  const accuracyShape = useMemo(
    () =>
      accuracyFix && accuracyRadiusM != null
        ? makeCircleFeature(accuracyFix.longitude, accuracyFix.latitude, accuracyRadiusM)
        : null,
    [accuracyFix, accuracyRadiusM],
  )
  const liveTrailShape = useMemo(
    () => (liveLocations.length >= 2 ? makeTrailLineString(liveLocations) : null),
    [liveLocations],
  )
  const rideRouteShape = useMemo(
    () =>
      rideRoute.length > 1
        ? ({
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: rideRoute },
            properties: {},
          } as const)
        : null,
    [rideRoute],
  )

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setInitialApproximateFix(gpsPresentation.nextInitialApproximateFix)
    })
    return () => cancelAnimationFrame(frame)
  }, [gpsPresentation.nextInitialApproximateFix])

  return {
    gpsFix,
    cameraFix,
    accuracyFix,
    accuracyShape,
    approximateGpsPuckActive,
    directionBearingDeg,
    retainedGpsBearingSourceTimestamp: gpsPresentation.directionBearingSourceTimestamp,
    riderFocusRows,
    mapRiders,
    trackedMapPoints,
    rideRoute,
    liveTrailShape,
    rideRouteShape,
  }
}
