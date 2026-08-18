import { useCallback, useEffect, useMemo, useRef } from 'react'
import { ActivityIndicator, View, StyleSheet } from 'react-native'
import { useSharedValue } from 'react-native-reanimated'

import { VescapeWordmark } from '@/components/base/VescapeWordmark'
import { MainMap, type MainMapHandle } from '@/screens/main/map/MainMap'
import { MainOverlays } from '@/screens/main/overlays/MainOverlays'
import { useMainScreenController } from '@/screens/main/useMainScreenController'
import { useMainScreenMapTargets } from '@/screens/main/useMainScreenMapTargets'

import type { Board } from '@/modules/board/store/boardStore'
import { theme } from '@/constants/theme'

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
  const targets = useMainScreenMapTargets(controller, mapRef)
  const {
    offscreenMapIndicators,
    selectedNavigationTarget,
    activeNavigationTarget,
    longPressMapTarget,
    mapInteractionHandlerRef,
  } = targets

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
      onToggleSelection: targets.handleToggleMapPointSelection,
      onCameraSettled: controller.refreshNearbyMapPoints,
    }),
    [
      controller.hiddenMapPointCategories,
      controller.mapPoints,
      controller.refreshNearbyMapPoints,
      controller.selectedMapPointId,
      targets.handleToggleMapPointSelection,
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
        onLongPressTarget={targets.handleLongPressTarget}
        onMapInteraction={targets.handleMapInteraction}
        onRawMapPress={targets.handleRawMapPress}
        onMapPress={targets.handleMapPress}
        onEnterMapMode={controller.handleMapFocus}
        onOffscreenMapIndicatorsChange={targets.setOffscreenMapIndicators}
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
          onLongPressMapTargetHandled: () => targets.setLongPressMapTarget(null),
          onSelectNavigationTarget: targets.handleSelectNavigationTarget,
          onNavigateTarget: targets.handleNavigateTarget,
          onNavigateSelectedTarget: targets.handleNavigateSelectedTarget,
          onCancelNavigation: targets.handleClearDirectionPoint,
          onDismissSelectedTarget: targets.handleDismissSelectedTarget,
          updateMapPoint: targets.handleUpdateMapPoint,
          setMapPointReaction: targets.handleSetMapPointReaction,
          onRemoveMapPoint: targets.handleRemoveMapPoint,
          offscreenMapIndicators,
          onOffscreenIndicatorPress: targets.handleOffscreenIndicatorPress,
        }}
        history={buildHistoryOverlayProps(controller)}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.palette.slate.surfaceDeep,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 24,
  },
})
