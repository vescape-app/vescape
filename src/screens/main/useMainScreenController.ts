import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { BackHandler, ToastAndroid } from 'react-native'
import { useFocusEffect } from 'expo-router'
import { useShallow } from 'zustand/react/shallow'

import { exitApp } from 'vescape-core'

import type { MainMapHandle } from '@/screens/main/map/MainMap'
import { useMainScreenHistoryNavigation } from '@/screens/main/useMainScreenHistoryNavigation'
import { useMainScreenStore } from '@/screens/main/mainScreenStore'
import { getNextRideSession, getPreviousRideSession } from '@/screens/main/mainState'
import { useBleStore } from '@/modules/board/store/bleStore'
import { useHistoryStore } from '@/modules/history/store/historyStore'
import { useHistoryFavorites } from '@/screens/main/history/useHistoryFavorites'
import { useMapStore } from '@/modules/map/store/mapStore'
import { useMapPointStore } from '@/modules/map-points/store/mapPointStore'
import { useMapContributionReady } from '@/modules/profile/hooks/useMapContributionReady'
import { useSettingsStore } from '@/modules/settings/store/settingsStore'
import { useFavoriteMedia } from '@/modules/history/hooks/useMediaHistory'
import type { MediaAssetInput } from '@/modules/history/lib/mediaHistory'
import { getHistoryPreviewRoute } from '@/modules/history/lib/previewRoute'
import { themeOverrideForMapStyle } from '@/modules/map/lib/mapTheme'

interface UseMainScreenControllerArgs {
  mapRef: RefObject<MainMapHandle | null>
}

export function useMainScreenController({ mapRef }: UseMainScreenControllerArgs) {
  const backPressedOnce = useRef(false)
  const [openMediaAssetId, setOpenMediaAssetId] = useState<string | null>(null)
  const {
    mode,
    historySheetVisible,
    mapSelector,
    perspectiveEnabled,
    activeHistoryMapMetric,
    enterTelemetry,
    enterMap,
    enterWeather,
    enterLegalLimits,
    enterHistory,
    setHistorySheetVisible,
    setMapSelector,
    dismissMapSelector,
    setPerspectiveEnabled,
    setActiveHistoryMapMetric,
  } = useMainScreenStore(
    useShallow((s) => ({
      mode: s.mode,
      historySheetVisible: s.historySheetVisible,
      mapSelector: s.mapSelector,
      perspectiveEnabled: s.perspectiveEnabled,
      activeHistoryMapMetric: s.activeHistoryMapMetric,
      enterTelemetry: s.enterTelemetry,
      enterMap: s.enterMap,
      enterWeather: s.enterWeather,
      enterLegalLimits: s.enterLegalLimits,
      enterHistory: s.enterHistory,
      setHistorySheetVisible: s.setHistorySheetVisible,
      setMapSelector: s.setMapSelector,
      dismissMapSelector: s.dismissMapSelector,
      setPerspectiveEnabled: s.setPerspectiveEnabled,
      setActiveHistoryMapMetric: s.setActiveHistoryMapMetric,
    })),
  )
  const liveLocations = useBleStore((s) => s.liveLocationHistory)
  const latestApproximateLocation = useBleStore((s) => s.latestApproximateLocation)
  const mapStyleKey = useSettingsStore((s) => s.mapStyleKey)
  const satelliteOverlayEnabled = useSettingsStore((s) => s.satelliteOverlayEnabled)
  const satelliteImageryOpacity = useSettingsStore((s) => s.satelliteImageryOpacity)
  const satelliteMapImageryOpacity = useSettingsStore((s) => s.satelliteMapImageryOpacity)
  const satelliteImagerySaturation = useSettingsStore((s) => s.satelliteImagerySaturation)
  const hideTelemetryMapDetails = useSettingsStore((s) => s.hideTelemetryMapDetails)
  const mapOrientationMode = useSettingsStore((s) => s.mapOrientationMode)
  const setSetting = useSettingsStore((s) => s.set)
  const {
    blocks,
    sessions,
    selectedSession,
    sessionSamples,
    sessionChartSamples,
    sessionGpsSamples,
    sessionMarkers,
    loadingSession,
    loading: historyLoading,
    hasMore: historyHasMore,
    error: historyError,
    loadMore,
    selectSession,
    removeSelectedSession,
  } = useHistoryStore(
    useShallow((s) => ({
      blocks: s.blocks,
      sessions: s.sessions,
      selectedSession: s.selectedSession,
      sessionSamples: s.sessionSamples,
      sessionChartSamples: s.sessionChartSamples,
      sessionGpsSamples: s.sessionGpsSamples,
      sessionMarkers: s.sessionMarkers,
      loadingSession: s.loadingSession,
      loading: s.loading,
      hasMore: s.hasMore,
      error: s.error,
      loadMore: s.loadMore,
      selectSession: s.selectSession,
      removeSelectedSession: s.removeSelectedSession,
    })),
  )
  const historyFavorites = useHistoryFavorites(selectedSession, blocks)
  const cancelHistoryTrim = historyFavorites.cancelTrim
  const {
    mapPoints,
    selectedMapPointId,
    hiddenMapPointCategories,
    refreshNearbyMapPoints,
    reloadMapPoints,
    addMapPoint,
    updateMapPoint,
    setMapPointReaction,
    removeMapPoint,
    selectMapPoint,
    toggleMapPointSelection,
    clearSelectedMapPoints,
    toggleMapPointCategoryVisibility,
  } = useMapPointStore(
    useShallow((s) => ({
      mapPoints: s.mapPoints,
      selectedMapPointId: s.selectedMapPointId,
      hiddenMapPointCategories: s.hiddenMapPointCategories,
      refreshNearbyMapPoints: s.refreshNearby,
      reloadMapPoints: s.reload,
      addMapPoint: s.addMapPoint,
      updateMapPoint: s.editMapPoint,
      setMapPointReaction: s.setMapPointReaction,
      removeMapPoint: s.removeMapPoint,
      selectMapPoint: s.selectMapPoint,
      toggleMapPointSelection: s.toggleMapPointSelection,
      clearSelectedMapPoints: s.clearSelectedMapPoints,
      toggleMapPointCategoryVisibility: s.toggleMapPointCategoryVisibility,
    })),
  )
  const { loadDirectionPoint, directionPoint, setDirectionPoint, clearDirectionPoint } =
    useMapStore(
      useShallow((s) => ({
        loadDirectionPoint: s.loadDirectionPoint,
        directionPoint: s.directionPoint,
        setDirectionPoint: s.setDirectionPoint,
        clearDirectionPoint: s.clearDirectionPoint,
      })),
    )
  const mediaHistory = useFavoriteMedia({
    favoriteId: historyFavorites.openFavorite?.id ?? null,
    selectedSession,
    gpsSamples: sessionGpsSamples,
    markers: sessionMarkers,
  })

  const canContribute = useMapContributionReady()

  useEffect(() => {
    void loadDirectionPoint()
  }, [loadDirectionPoint])

  // Signing in changes what the server says about the visible Map Points (`ownedByMe`,
  // `myReaction`), and those only arrive with a read. Without this the rider would have to pan
  // before their own votes and edit buttons showed up.
  useEffect(() => {
    void reloadMapPoints()
  }, [canContribute, reloadMapPoints])

  const weatherActive = mode === 'weather'
  const legalLimitsActive = mode === 'legalLimits'
  const historyActive = mode === 'history'
  const rotationLocked = mapOrientationMode === 'northUp'
  const previousRide = getPreviousRideSession(sessions, selectedSession)
  const nextRide = getNextRideSession(sessions, selectedSession)
  const canPreviousRide = !!previousRide || historyHasMore

  const historyPreview = useMemo(() => {
    if (!selectedSession) return null
    if (!loadingSession) return null
    const latitude = selectedSession.centerLatitude ?? sessionGpsSamples[0]?.latitude
    const longitude = selectedSession.centerLongitude ?? sessionGpsSamples[0]?.longitude
    if (latitude == null || longitude == null) return null
    return {
      key: selectedSession.id,
      latitude,
      longitude,
      minLatitude: selectedSession.minLatitude,
      maxLatitude: selectedSession.maxLatitude,
      minLongitude: selectedSession.minLongitude,
      maxLongitude: selectedSession.maxLongitude,
    }
  }, [loadingSession, selectedSession, sessionGpsSamples])

  const historyPreviewRoute = useMemo(
    () => (loadingSession ? getHistoryPreviewRoute(sessionGpsSamples) : []),
    [loadingSession, sessionGpsSamples],
  )

  const exitMapFocus = useCallback(() => {
    enterTelemetry()
    mapRef.current?.recenterLive()
  }, [enterTelemetry, mapRef])

  // An accidental reveal undone mid-pinch: back to telemetry without touching the camera, which
  // the pinch is still driving.
  const cancelMapFocus = useCallback(() => {
    enterTelemetry()
  }, [enterTelemetry])

  const enterWeatherMode = useCallback(() => {
    enterWeather()
    mapRef.current?.focusWeather()
  }, [enterWeather, mapRef])

  const exitWeatherMode = useCallback(() => {
    enterTelemetry()
    requestAnimationFrame(() => mapRef.current?.recenterLive())
  }, [enterTelemetry, mapRef])

  const enterLegalLimitsMode = useCallback(() => {
    enterLegalLimits()
    mapRef.current?.focusLegalLimits()
  }, [enterLegalLimits, mapRef])

  const exitLegalLimitsMode = useCallback(() => {
    enterTelemetry()
    requestAnimationFrame(() => mapRef.current?.recenterLive())
  }, [enterTelemetry, mapRef])

  const historyNavigation = useMainScreenHistoryNavigation({
    mapRef,
    enterHistory,
    enterTelemetry,
    historyFavorites,
    selectSession,
    removeSelectedSession,
    setHistorySheetVisible,
    setOpenMediaAssetId,
  })
  const {
    exitHistory,
    selectPreviousRide,
    selectNextRide,
    removeSession,
    selectRide,
    selectFavoriteRide,
  } = historyNavigation

  const handleMapFocus = useCallback(() => {
    if (mode === 'map') return
    enterMap()
    if (mode === 'weather' || mode === 'legalLimits') {
      requestAnimationFrame(() => mapRef.current?.recenterLive())
    }
  }, [enterMap, mapRef, mode])

  const setMapStyleKey = useCallback(
    (key: typeof mapStyleKey) => {
      // A basemap with an explicit appearance is the rider picking a theme, so it persists as one.
      // Satellite has no opinion and leaves the configured mode alone.
      const override = themeOverrideForMapStyle(key)
      if (override) void setSetting('themeMode', override)
      void setSetting('mapStyleKey', key)
    },
    [setSetting],
  )

  const setMapOrientationMode = useCallback(
    (nextMode: typeof mapOrientationMode) => {
      void setSetting('mapOrientationMode', nextMode)
    },
    [setSetting],
  )

  const setSatelliteMapImageryOpacity = useCallback(
    (nextOpacity: number) => {
      void setSetting('satelliteMapImageryOpacity', nextOpacity)
    },
    [setSetting],
  )

  useFocusEffect(
    useCallback(() => {
      const handler = BackHandler.addEventListener('hardwareBackPress', () => {
        if (mode === 'history') {
          if (useMainScreenStore.getState().trimRange) {
            void cancelHistoryTrim()
            return true
          }
          exitHistory()
          return true
        }
        if (mode === 'weather') {
          exitWeatherMode()
          return true
        }
        if (mode === 'legalLimits') {
          exitLegalLimitsMode()
          return true
        }
        if (mode === 'map') {
          exitMapFocus()
          return true
        }
        if (backPressedOnce.current) {
          exitApp()
          return true
        }
        backPressedOnce.current = true
        ToastAndroid.show('Press back again to exit', ToastAndroid.SHORT)
        setTimeout(() => {
          backPressedOnce.current = false
        }, 2000)
        return true
      })
      return () => handler.remove()
    }, [cancelHistoryTrim, exitHistory, exitLegalLimitsMode, exitMapFocus, exitWeatherMode, mode]),
  )

  return {
    mode,
    liveLocations,
    latestApproximateLocation,
    blocks,
    historyActive,
    legalLimitsActive,
    mapStyleKey,
    satelliteOverlayEnabled,
    satelliteImageryOpacity,
    satelliteMapImageryOpacity,
    setSatelliteMapImageryOpacity,
    satelliteImagerySaturation,
    hideTelemetryMapDetails,
    setMapStyleKey,
    mapOrientationMode,
    setMapOrientationMode,
    mapSelector,
    setMapSelector,
    dismissMapSelector,
    rotationLocked,
    perspectiveEnabled,
    setPerspectiveEnabled,
    directionPoint,
    mapPoints,
    selectedMapPointId,
    hiddenMapPointCategories,
    refreshNearbyMapPoints,
    addMapPoint,
    updateMapPoint,
    setMapPointReaction,
    setDirectionPoint,
    clearDirectionPoint,
    removeMapPoint,
    selectMapPoint,
    toggleMapPointSelection,
    clearSelectedMapPoints,
    toggleMapPointCategoryVisibility,
    sessions,
    selectedSession,
    sessionSamples,
    sessionChartSamples,
    sessionGpsSamples,
    sessionMarkers,
    mediaHistory,
    openMediaAssetId,
    openMedia: (asset: MediaAssetInput) => setOpenMediaAssetId(asset.id),
    closeMedia: () => setOpenMediaAssetId(null),
    historyPreview,
    historyPreviewRoute,
    previousRide,
    nextRide,
    canPreviousRide,
    loadingSession,
    historyLoading,
    historyHasMore,
    historyError,
    historySheetVisible,
    setHistorySheetVisible,
    ...historyFavorites,
    selectSession,
    loadMoreHistory: loadMore,
    selectPreviousRide,
    selectNextRide,
    exitHistory,
    removeSession,
    selectRide,
    selectFavoriteRide,
    weatherActive,
    enterWeatherMode,
    exitWeatherMode,
    enterLegalLimitsMode,
    exitLegalLimitsMode,
    handleMapFocus,
    exitMapFocus,
    cancelMapFocus,
    activeHistoryMapMetric,
    setActiveHistoryMapMetric,
  }
}
