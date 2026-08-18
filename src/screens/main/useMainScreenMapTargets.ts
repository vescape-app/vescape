import { useCallback, useEffect, useRef, useState } from 'react'

import type { MapPointPatch } from 'vescape-core'

import type { MapSelection } from '@/modules/map/lib/mapSelection'
import { getMapPointKindLabel } from '@/modules/map-points/constants/mapPoints'
import { reverseGeocodeMapCoordinate } from '@/modules/map/lib/search'
import { useMapStore } from '@/modules/map/store/mapStore'
import type { OffscreenMapIndicatorState } from '@/screens/main/map/offscreenMapIndicators'
import type { MainMapHandle } from '@/screens/main/map/MainMap'
import type { useMainScreenController } from '@/screens/main/useMainScreenController'

/**
 * The map's write side: what the rider tapped, long-pressed or is navigating to, and the reverse
 * geocoding that fills a dropped pin in after the fact.
 */
export function useMainScreenMapTargets(
  controller: ReturnType<typeof useMainScreenController>,
  mapRef: React.RefObject<MainMapHandle | null>,
) {
  const [offscreenMapIndicators, setOffscreenMapIndicators] = useState<
    OffscreenMapIndicatorState[]
  >([])
  const [selectedNavigationTarget, setSelectedNavigationTarget] = useState<MapSelection | null>(
    null,
  )
  const [longPressMapTarget, setLongPressMapTarget] = useState<MapSelection | null>(null)
  const [activeNavigationTarget, setActiveNavigationTarget] = useState<MapSelection | null>(null)
  const dismissMapSelector = controller.dismissMapSelector
  const mapInteractionHandlerRef = useRef<(selection?: MapSelection) => boolean | undefined>(
    () => {},
  )
  const handleMapInteraction = useCallback(() => {
    dismissMapSelector()
    mapInteractionHandlerRef.current()
  }, [dismissMapSelector])
  const {
    setDirectionPoint,
    clearSelectedMapPoints,
    removeMapPoint,
    clearDirectionPoint,
    updateMapPoint,
    setMapPointReaction,
    selectMapPoint,
    toggleMapPointSelection,
  } = controller
  const handleLongPressTarget = useCallback((target: { latitude: number; longitude: number }) => {
    setLongPressMapTarget({
      type: 'coordinate',
      id: `long-press-${target.longitude.toFixed(6)}-${target.latitude.toFixed(6)}`,
      latitude: target.latitude,
      longitude: target.longitude,
      title: 'Dropped pin',
      subtitle: null,
      loadingDetails: true,
    })
  }, [])
  const handleRawMapPress = useCallback((selection: MapSelection) => {
    return mapInteractionHandlerRef.current(selection) === true
  }, [])
  const handleMapPress = useCallback(
    (selection: MapSelection) => {
      handleMapInteraction()
      clearSelectedMapPoints()
      setSelectedNavigationTarget(selection)
    },
    [clearSelectedMapPoints, handleMapInteraction],
  )
  const handleSelectNavigationTarget = useCallback(
    (selection: MapSelection) => {
      if (selection.type === 'mapPoint') {
        selectMapPoint(selection.id)
      } else {
        clearSelectedMapPoints()
      }
      setSelectedNavigationTarget(selection)
    },
    [clearSelectedMapPoints, selectMapPoint],
  )
  const handleToggleMapPointSelection = useCallback(
    (id: string) => {
      const selected = controller.selectedMapPointId !== id
      const point = controller.mapPoints.find((candidate) => candidate.id === id)
      toggleMapPointSelection(id)
      if (!selected || !point) {
        setSelectedNavigationTarget(null)
        return
      }
      setSelectedNavigationTarget({
        type: 'mapPoint',
        id: point.id,
        latitude: point.latitude,
        longitude: point.longitude,
        title: point.name?.trim() || getMapPointKindLabel(point.category),
        subtitle: point.description ?? null,
        point,
      })
    },
    [controller.mapPoints, controller.selectedMapPointId, toggleMapPointSelection],
  )
  const handleRemoveMapPoint = useCallback(
    (id: string) => {
      setSelectedNavigationTarget((current) =>
        current?.type === 'mapPoint' && current.id === id ? null : current,
      )
      setActiveNavigationTarget((current) =>
        current?.type === 'mapPoint' && current.point.id === id ? null : current,
      )
      void removeMapPoint(id)
    },
    [removeMapPoint],
  )
  const handleSetMapPointReaction = useCallback(
    (id: string, reaction: 'up' | 'down' | null) => {
      void setMapPointReaction(id, reaction).then((point) => {
        if (!point) return
        setSelectedNavigationTarget((current) =>
          current?.type === 'mapPoint' && current.id === id
            ? {
                ...current,
                point,
                title: point.name || getMapPointKindLabel(point.category),
                subtitle: point.description ?? null,
              }
            : current,
        )
      })
    },
    [setMapPointReaction],
  )
  const handleUpdateMapPoint = useCallback(
    async (id: string, patch: MapPointPatch) => {
      const point = await updateMapPoint(id, patch)
      if (!point) return null
      const nextSelection: MapSelection = {
        type: 'mapPoint',
        id: point.id,
        latitude: point.latitude,
        longitude: point.longitude,
        title: point.name || getMapPointKindLabel(point.category),
        subtitle: point.description ?? null,
        point,
      }
      setSelectedNavigationTarget((current) =>
        current?.type === 'mapPoint' && current.id === id ? nextSelection : current,
      )
      setActiveNavigationTarget((current) =>
        current?.type === 'mapPoint' && current.point.id === id
          ? {
              ...current,
              title: nextSelection.title,
              subtitle: nextSelection.subtitle,
              point,
            }
          : current,
      )
      return point
    },
    [updateMapPoint],
  )
  const handleClearDirectionPoint = useCallback(() => {
    setActiveNavigationTarget(null)
    void clearDirectionPoint()
  }, [clearDirectionPoint])
  const handleDismissSelectedTarget = useCallback(() => {
    clearSelectedMapPoints()
    setSelectedNavigationTarget(null)
  }, [clearSelectedMapPoints])

  useEffect(() => {
    if (controller.mode !== 'telemetry') return
    const frame = requestAnimationFrame(() => {
      clearSelectedMapPoints()
      setSelectedNavigationTarget(null)
    })
    return () => cancelAnimationFrame(frame)
  }, [clearSelectedMapPoints, controller.mode])

  const handleOffscreenIndicatorPress = useCallback(
    (indicator: OffscreenMapIndicatorState) => {
      controller.dismissMapSelector()
      setSelectedNavigationTarget(null)
      if (indicator.type === 'gps') {
        mapRef.current?.recenterLive({ resetPadding: true })
        return
      }
      controller.handleMapFocus()
      mapRef.current?.focusCoordinate(indicator.coordinate.value)
    },
    [controller, mapRef],
  )
  const navigateToTarget = useCallback(
    async (target: MapSelection) => {
      await setDirectionPoint(target.latitude, target.longitude)
      setActiveNavigationTarget({
        ...target,
        id: `direction-${target.id}`,
        title: target.type === 'coordinate' ? 'Direction point' : target.title,
      })
      clearSelectedMapPoints()
      setSelectedNavigationTarget(null)
      // Deliberately stays on the map: the path is a proposal until the rider accepts it from the
      // navigation sheet, which is what closes the map. See `onConfirmNavigation`.
    },
    [clearSelectedMapPoints, setDirectionPoint],
  )
  const handleNavigateSelectedTarget = useCallback(async () => {
    if (!selectedNavigationTarget) return
    await navigateToTarget(selectedNavigationTarget)
  }, [navigateToTarget, selectedNavigationTarget])
  const handleNavigateTarget = useCallback(
    async (target: MapSelection) => {
      await navigateToTarget(target)
    },
    [navigateToTarget],
  )

  // A location shared from another app arrives as a plain coordinate, and from here on it is
  // treated exactly like a target the rider picked themselves: same Direction Point, same sheet,
  // same camera. Nothing about it is shared onward — it never becomes a Map Point.
  const pendingSharedLocation = useMapStore((s) => s.pendingSharedLocation)
  const consumeSharedLocation = useMapStore((s) => s.consumeSharedLocation)
  const handleMapFocus = controller.handleMapFocus
  useEffect(() => {
    if (!pendingSharedLocation) return
    consumeSharedLocation()
    const { latitude, longitude, name } = pendingSharedLocation
    const id = `shared-${longitude.toFixed(6)}-${latitude.toFixed(6)}`
    // A named payload is a place, and stays one: a coordinate target is renamed "Direction point"
    // on the way in, which would throw away the name the other app sent.
    const target: MapSelection = name
      ? { type: 'place', id, latitude, longitude, title: name, subtitle: null, category: null }
      : {
          type: 'coordinate',
          id,
          latitude,
          longitude,
          title: 'Shared location',
          subtitle: null,
          loadingDetails: true,
        }
    handleMapFocus()
    void navigateToTarget(target)
    mapRef.current?.focusCoordinate([longitude, latitude])
  }, [
    consumeSharedLocation,
    handleMapFocus,
    mapRef,
    navigateToTarget,
    pendingSharedLocation,
  ])

  useEffect(() => {
    if (!selectedNavigationTarget?.loadingDetails) return
    const abortController = new AbortController()
    const { id, latitude, longitude, type } = selectedNavigationTarget
    void reverseGeocodeMapCoordinate(latitude, longitude, { signal: abortController.signal })
      .then((details) => {
        if (!details) {
          setSelectedNavigationTarget((current) =>
            current?.id === id && current.type === type
              ? { ...current, loadingDetails: false }
              : current,
          )
          return
        }
        setSelectedNavigationTarget((current) =>
          current?.id === id && current.type === type
            ? {
                ...current,
                title: current.type === 'coordinate' ? details.title : current.title,
                subtitle: current.subtitle ?? details.subtitle,
                loadingDetails: false,
              }
            : current,
        )
      })
      .catch(() => {
        if (abortController.signal.aborted) return
        setSelectedNavigationTarget((current) =>
          current?.id === id && current.type === type
            ? { ...current, loadingDetails: false }
            : current,
        )
      })
    return () => abortController.abort()
  }, [selectedNavigationTarget])

  useEffect(() => {
    if (!activeNavigationTarget?.loadingDetails) return
    const abortController = new AbortController()
    const { id, latitude, longitude, type } = activeNavigationTarget
    void reverseGeocodeMapCoordinate(latitude, longitude, { signal: abortController.signal })
      .then((details) => {
        setActiveNavigationTarget((current) =>
          current?.id === id && current.type === type
            ? {
                ...current,
                subtitle: current.subtitle ?? details?.subtitle ?? null,
                loadingDetails: false,
              }
            : current,
        )
      })
      .catch(() => {
        if (abortController.signal.aborted) return
        setActiveNavigationTarget((current) =>
          current?.id === id && current.type === type
            ? { ...current, loadingDetails: false }
            : current,
        )
      })
    return () => abortController.abort()
  }, [activeNavigationTarget])

  return {
    offscreenMapIndicators,
    setOffscreenMapIndicators,
    selectedNavigationTarget,
    activeNavigationTarget,
    longPressMapTarget,
    setLongPressMapTarget,
    mapInteractionHandlerRef,
    handleMapInteraction,
    handleLongPressTarget,
    handleRawMapPress,
    handleMapPress,
    handleSelectNavigationTarget,
    handleToggleMapPointSelection,
    handleRemoveMapPoint,
    handleSetMapPointReaction,
    handleUpdateMapPoint,
    handleClearDirectionPoint,
    handleDismissSelectedTarget,
    handleOffscreenIndicatorPress,
    handleNavigateSelectedTarget,
    handleNavigateTarget,
  }
}
