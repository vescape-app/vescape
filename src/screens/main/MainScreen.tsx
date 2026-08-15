import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, View, StyleSheet } from 'react-native'
import { useSharedValue } from 'react-native-reanimated'

import { VescapeWordmark } from '@/components/base/VescapeWordmark'
import { MainMap, type MainMapHandle } from '@/screens/main/map/MainMap'
import type { OffscreenMapIndicatorState } from '@/screens/main/map/offscreenMapIndicators'
import { MainOverlays } from '@/screens/main/overlays/MainOverlays'
import { useMainScreenController } from '@/screens/main/useMainScreenController'
import type { MapPointPatch } from 'vescape-core'

import type { Board } from '@/modules/board/store/boardStore'
import { theme } from '@/constants/theme'
import { getMapPointKindLabel } from '@/modules/map-points/constants/mapPoints'
import type { MapSelection } from '@/modules/map/lib/mapSelection'
import { reverseGeocodeMapCoordinate } from '@/modules/map/lib/search'

interface MainScreenProps {
  activeBoard: Board | undefined
  activeBoardId: string | null
  boards: Board[]
  boardsLoaded: boolean
  bleStatus: string
  onStopScan: () => void
  onRetryConnect: () => void
  onSelectBoard: (id: string) => void
  onAddBoard: () => void
}

function buildHistoryOverlayProps(controller: ReturnType<typeof useMainScreenController>) {
  return {
    enterHistoryMode: controller.enterHistoryMode,
    selectedSession: controller.selectedSession,
    sessionSamples: controller.sessionSamples,
    sessionChartSamples: controller.sessionChartSamples,
    sessionGpsSamples: controller.sessionGpsSamples,
    sessionMarkers: controller.sessionMarkers,
    nextRide: controller.nextRide,
    canPreviousRide: controller.canPreviousRide,
    loadingSession: controller.loadingSession,
    historyLoading: controller.historyLoading,
    historyHasMore: controller.historyHasMore,
    historyError: controller.historyError,
    blocks: controller.blocks,
    sessions: controller.sessions,
    historySheetVisible: controller.historySheetVisible,
    setHistorySheetVisible: controller.setHistorySheetVisible,
    historyTab: controller.historyTab,
    selectHistoryTab: controller.selectHistoryTab,
    favorites: controller.favorites,
    favoritesLoading: controller.favoritesLoading,
    favoritesSaving: controller.favoritesSaving,
    favoritesError: controller.favoritesError,
    selectedSessionFavorite: controller.selectedSessionFavorite,
    trimming: controller.trimming,
    trimSeed: controller.trimSeed,
    beginTrimFavorite: controller.beginTrimFavorite,
    beginEditFavorite: controller.beginEditFavorite,
    updateTrimRange: controller.updateTrimRange,
    cancelTrim: controller.cancelTrim,
    saveTrim: controller.saveTrim,
    favoriteSessions: controller.favoriteSessions,
    canPreviousFavorite: controller.canPreviousFavorite,
    canNextFavorite: controller.canNextFavorite,
    selectPreviousFavorite: controller.selectPreviousFavorite,
    selectNextFavorite: controller.selectNextFavorite,
    openFavorite: controller.openFavorite,
    selectFavorite: controller.selectFavorite,
    removeOpenFavorite: controller.removeOpenFavorite,
    loadMoreHistory: controller.loadMoreHistory,
    selectPreviousRide: controller.selectPreviousRide,
    selectNextRide: controller.selectNextRide,
    selectRide: controller.selectRide,
    exitHistory: controller.exitHistory,
    removeSession: controller.removeSession,
    setActiveHistoryMapMetric: controller.setActiveHistoryMapMetric,
    mediaHistory: controller.mediaHistory,
    openMedia: controller.openMedia,
    openMediaAssetId: controller.openMediaAssetId,
    closeMedia: controller.closeMedia,
  }
}

export function MainScreen({
  activeBoard,
  activeBoardId,
  boards,
  boardsLoaded,
  bleStatus,
  onStopScan,
  onRetryConnect,
  onSelectBoard,
  onAddBoard,
}: MainScreenProps) {
  const mapRef = useRef<MainMapHandle>(null)
  const cameraHeading = useSharedValue(0)
  const selectorHeading = useSharedValue(0)
  const controller = useMainScreenController({ mapRef })
  const handleHeadingChange = useCallback(
    (heading: number) => {
      cameraHeading.set(heading)
      if (!(controller.mode === 'telemetry' && controller.mapOrientationMode === 'phoneHeading')) {
        selectorHeading.set(heading)
      }
    },
    [cameraHeading, controller.mapOrientationMode, controller.mode, selectorHeading],
  )
  const handlePhoneHeadingChange = useCallback(
    (heading: number | null) => {
      if (heading == null) return
      if (controller.mode === 'telemetry' && controller.mapOrientationMode === 'phoneHeading') {
        selectorHeading.set(heading)
      }
    },
    [controller.mapOrientationMode, controller.mode, selectorHeading],
  )
  useEffect(() => {
    if (controller.mode === 'telemetry' && controller.mapOrientationMode === 'phoneHeading') return
    selectorHeading.set(cameraHeading.value)
  }, [cameraHeading, controller.mapOrientationMode, controller.mode, selectorHeading])
  const [offscreenMapIndicators, setOffscreenMapIndicators] = useState<
    OffscreenMapIndicatorState[]
  >([])
  const [selectedNavigationTarget, setSelectedNavigationTarget] = useState<MapSelection | null>(
    null,
  )
  const [longPressMapTarget, setLongPressMapTarget] = useState<MapSelection | null>(null)
  const [activeNavigationTarget, setActiveNavigationTarget] = useState<MapSelection | null>(null)
  const dismissMapSelector = controller.dismissMapSelector
  const mapInteractionHandlerRef = useRef<(selection?: MapSelection) => boolean | void>(() => {})
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
    [controller],
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

  // Grouped MainMap props are memoized so the memo'd map does not re-render on every
  // MainScreen render just because a fresh object literal was handed to it.
  const mapHistoryProps = useMemo(
    () => ({
      active: controller.historyActive,
      selectionKey: controller.selectedSession?.id ?? null,
      preview: controller.historyPreview,
      previewRoute: controller.historyPreviewRoute,
      gpsSamples: controller.sessionGpsSamples,
      telemetrySamples: controller.sessionSamples,
      markers: controller.sessionMarkers,
      mediaAssets: controller.mediaHistory.assets,
      favoriteRanges:
        controller.historyTab === 'history'
          ? controller.favorites.map(({ startMs, endMs }) => ({ startMs, endMs }))
          : [],
      onOpenMedia: controller.openMedia,
      activeMapMetric: controller.activeHistoryMapMetric,
    }),
    [
      controller.activeHistoryMapMetric,
      controller.historyActive,
      controller.historyPreview,
      controller.historyPreviewRoute,
      controller.historyTab,
      controller.favorites,
      controller.mediaHistory.assets,
      controller.openMedia,
      controller.selectedSession?.id,
      controller.sessionGpsSamples,
      controller.sessionMarkers,
      controller.sessionSamples,
    ],
  )

  const mapStyleProps = useMemo(
    () => ({
      mapStyleKey: controller.mapStyleKey,
      satelliteOverlayEnabled: controller.satelliteOverlayEnabled,
      satelliteImageryOpacity: controller.satelliteImageryOpacity,
      satelliteMapImageryOpacity: controller.satelliteMapImageryOpacity,
      satelliteImagerySaturation: controller.satelliteImagerySaturation,
      hideTelemetryMapDetails: controller.hideTelemetryMapDetails,
    }),
    [
      controller.hideTelemetryMapDetails,
      controller.mapStyleKey,
      controller.satelliteImageryOpacity,
      controller.satelliteImagerySaturation,
      controller.satelliteMapImageryOpacity,
      controller.satelliteOverlayEnabled,
    ],
  )

  const mapPointProps = useMemo(
    () => ({
      points: controller.mapPoints,
      selectedId: controller.selectedMapPointId,
      hiddenCategories: controller.hiddenMapPointCategories,
      onToggleSelection: handleToggleMapPointSelection,
      onCameraSettled: controller.refreshNearbyMapPoints,
    }),
    [
      controller.hiddenMapPointCategories,
      controller.mapPoints,
      controller.refreshNearbyMapPoints,
      controller.selectedMapPointId,
      handleToggleMapPointSelection,
    ],
  )

  if (!boardsLoaded) {
    return (
      <View style={styles.container}>
        <View style={styles.empty}>
          <VescapeWordmark width={220} />
          <ActivityIndicator size="small" color={theme.palette.sky.color} />
        </View>
      </View>
    )
  }

  return (
    <View style={styles.container}>
      <MainMap
        ref={mapRef}
        mode={controller.mode}
        liveLocations={controller.liveLocations}
        latestApproximateLocation={controller.latestApproximateLocation}
        history={mapHistoryProps}
        style={mapStyleProps}
        mapPoints={mapPointProps}
        mapOrientationMode={controller.mapOrientationMode}
        rotationLocked={controller.rotationLocked}
        perspectiveEnabled={controller.perspectiveEnabled}
        onPerspectiveChange={controller.setPerspectiveEnabled}
        onHeadingChange={handleHeadingChange}
        onPhoneHeadingChange={handlePhoneHeadingChange}
        onLongPressTarget={handleLongPressTarget}
        onMapInteraction={handleMapInteraction}
        onRawMapPress={handleRawMapPress}
        onMapPress={handleMapPress}
        onEnterMapMode={controller.handleMapFocus}
        onOffscreenMapIndicatorsChange={setOffscreenMapIndicators}
        directionPoint={controller.directionPoint}
        activeNavigationTarget={activeNavigationTarget}
        selectedNavigationTarget={selectedNavigationTarget}
        weatherActive={controller.weatherActive}
        legalLimitsActive={controller.legalLimitsActive}
      />
      <MainOverlays
        mode={controller.mode}
        mapRef={mapRef}
        mapInteractionHandlerRef={mapInteractionHandlerRef}
        board={{
          boards,
          activeBoardId,
          activeBoard,
          bleStatus,
          onStopScan,
          onRetryConnect,
          onSelectBoard,
          onAddBoard,
        }}
        map={{
          heading: selectorHeading,
          mapStyleKey: controller.mapStyleKey,
          setMapStyleKey: controller.setMapStyleKey,
          mapOrientationMode: controller.mapOrientationMode,
          setMapOrientationMode: controller.setMapOrientationMode,
          mapSelector: controller.mapSelector,
          setMapSelector: controller.setMapSelector,
          enterMapFocus: controller.handleMapFocus,
          exitMapFocus: controller.exitMapFocus,
          enterWeather: controller.enterWeatherMode,
          exitWeather: controller.exitWeatherMode,
          enterLegalLimits: controller.enterLegalLimitsMode,
          exitLegalLimits: controller.exitLegalLimitsMode,
          weatherLocation: controller.liveLocations.at(-1) ?? controller.latestApproximateLocation,
          directionPoint: controller.directionPoint,
          activeNavigationTarget,
          selectedNavigationTarget,
          longPressMapTarget,
          onLongPressMapTargetHandled: () => setLongPressMapTarget(null),
          onSelectNavigationTarget: handleSelectNavigationTarget,
          onNavigateTarget: handleNavigateTarget,
          onNavigateSelectedTarget: handleNavigateSelectedTarget,
          onCancelNavigation: handleClearDirectionPoint,
          onDismissSelectedTarget: handleDismissSelectedTarget,
          updateMapPoint: handleUpdateMapPoint,
          setMapPointReaction: handleSetMapPointReaction,
          onRemoveMapPoint: handleRemoveMapPoint,
          offscreenMapIndicators,
          onOffscreenIndicatorPress: handleOffscreenIndicatorPress,
        }}
        history={buildHistoryOverlayProps(controller)}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.neutral.bg,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 24,
  },
})
