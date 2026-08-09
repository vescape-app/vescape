import Mapbox from '@rnmapbox/maps'
import { forwardRef, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Animated, View } from 'react-native'
import type { LocationEvent, MapPoint, MapPointCategory } from 'vescape-core'

import type { DirectionPoint } from '@/modules/map/store/mapStore'

import { MAPBOX_ACCESS_TOKEN } from '@/config/mapy'
import { captureMode } from '@/config/env'
import {
  MAP_DEFAULTS,
  type MapNavigationMode,
  type MapStyleKey,
} from '@/modules/map/constants/mapStyles'
import type { MediaHistoryAsset } from '@/modules/history/lib/mediaHistory'
import type { MapSelection } from '@/modules/map/lib/mapSelection'
import type { HistoryMetricKey } from '@/modules/history/lib/metricColorScale'
import { getGpsPuckBearing } from '@/modules/map/lib/gpsPuckHeading'
import { usePhoneHeadingAdapter } from '@/screens/main/map/usePhoneHeadingAdapter'
import type {
  HistoryGpsSample,
  HistoryMarker,
  TelemetrySample,
} from '@/modules/history/store/historyStore'
import { useSettingsStore } from '@/modules/settings/store/settingsStore'
import { useRenderRateWarning } from '@/hooks/useRenderRateWarning'

import type { MainViewState } from '@/screens/main/mainViewState'
import { type HistoryPreviewTarget, useCameraControls } from '@/screens/main/map/useCameraControls'
import type { PhoneHeadingStatus } from '@/modules/map/lib/phoneHeading'
import type { OffscreenMapIndicatorState } from '@/screens/main/map/offscreenMapIndicators'
import { MapLoadingPlaceholder, MapUnavailable } from '@/screens/main/map/MainMapOverlays'
import { MainMapScene } from '@/screens/main/map/MainMapScene'
import { useLiveMapModel } from '@/screens/main/map/useLiveMapModel'
import { useMainMapCameraEvents } from '@/screens/main/map/useMainMapCameraEvents'
import { useMainMapFocusActions } from '@/screens/main/map/useMainMapFocusActions'
import { useMapOverlaySelection } from '@/screens/main/map/useMapOverlaySelection'
import { useMapPressHandlers } from '@/screens/main/map/useMapPressHandlers'
import { useMapViewport } from '@/screens/main/map/useMapViewport'
import { useNavigationDiagnosticsSync } from '@/screens/main/map/useNavigationDiagnosticsSync'
import { useNavigationPathFraming } from '@/screens/main/map/useNavigationPathFraming'
import { useOffscreenMapIndicators } from '@/screens/main/map/useOffscreenMapIndicators'
import { useResolvedMapStyle } from '@/screens/main/map/useResolvedMapStyle'

Mapbox.setAccessToken(MAPBOX_ACCESS_TOKEN)

export interface MainMapHandle {
  recenterLive: (options?: { resetPadding?: boolean; animationDuration?: number }) => void
  previewHistorySession: (preview: HistoryPreviewTarget) => void
  beginPreviewPan: () => void
  previewPanBy: (deltaX: number, deltaY: number, revealProgress: number) => void
  endPreviewPan: () => void
  beginPreviewZoom: () => void
  previewZoomBy: (scale: number) => void
  endPreviewZoom: () => void
  restorePreviewPan: () => void
  resetRotation: () => void
  togglePerspective: () => void
  setPadding: (bottom: number) => void
  zoomBy: (delta: number) => void
  focusCoordinate: (coordinate: [number, number]) => void
  centerCoordinatePreservingCamera: (coordinate: [number, number]) => void
  focusWeather: () => void
  focusLegalLimits: () => void
  getViewfinderCoordinate: () => Promise<{ latitude: number; longitude: number }>
}

/** Everything only the history layers care about; MainMap passes it straight through. */
export interface MainMapHistoryProps {
  active: boolean
  selectionKey: string | null
  preview: ({ key: string } & HistoryPreviewTarget) | null
  previewRoute: [number, number][]
  gpsSamples: HistoryGpsSample[]
  telemetrySamples: TelemetrySample[]
  markers: HistoryMarker[]
  mediaAssets: MediaHistoryAsset[]
  favoriteRanges: { startMs: number; endMs: number }[]
  onOpenMedia: (asset: MediaHistoryAsset) => void
  activeMapMetric: HistoryMetricKey
}

export interface MainMapStyleProps {
  mapStyleKey: MapStyleKey
  satelliteOverlayEnabled: boolean
  satelliteImageryOpacity: number
  satelliteMapImageryOpacity: number
  satelliteImagerySaturation: number
  hideTelemetryMapDetails: boolean
}

export interface MainMapPointsProps {
  points: MapPoint[]
  selectedId: string | null
  hiddenCategories: MapPointCategory[]
  onToggleSelection: (id: string) => void
  /** Camera came to rest: where the map should read its Map Points around. */
  onCameraSettled: (latitude: number, longitude: number, zoom: number) => void
}

interface MainMapProps {
  mode: MainViewState
  liveLocations: LocationEvent[]
  latestApproximateLocation: LocationEvent | null
  history: MainMapHistoryProps
  style: MainMapStyleProps
  mapPoints: MainMapPointsProps
  mapNavigationMode: MapNavigationMode
  rotationLocked: boolean
  perspectiveEnabled: boolean
  onPerspectiveChange: (enabled: boolean) => void
  onHeadingChange: (heading: number) => void
  onPhoneHeadingChange: (heading: number | null) => void
  onLongPressTarget: (target: { latitude: number; longitude: number }) => void
  onMapInteraction: () => void
  onRawMapPress: (selection: MapSelection) => boolean | void
  onMapPress: (selection: MapSelection) => void
  onEnterMapMode: () => void
  onOffscreenMapIndicatorsChange: (indicators: OffscreenMapIndicatorState[]) => void
  directionPoint: DirectionPoint | null
  activeNavigationTarget: MapSelection | null
  selectedNavigationTarget: MapSelection | null
  weatherActive: boolean
  legalLimitsActive: boolean
}

export const MainMap = memo(
  forwardRef<MainMapHandle, MainMapProps>(function MainMap(
    {
      mode,
      liveLocations,
      latestApproximateLocation,
      history,
      style: styleProps,
      mapPoints: mapPointProps,
      mapNavigationMode,
      rotationLocked,
      perspectiveEnabled,
      onPerspectiveChange,
      onHeadingChange,
      onPhoneHeadingChange,
      onLongPressTarget,
      onMapInteraction,
      onRawMapPress,
      onMapPress,
      onEnterMapMode,
      onOffscreenMapIndicatorsChange,
      directionPoint,
      activeNavigationTarget,
      selectedNavigationTarget,
      weatherActive,
      legalLimitsActive,
    },
    ref,
  ) {
    const historyActive = history.active
    const historyPreview = history.preview
    const mapPoints = mapPointProps.points
    const selectedMapPointId = mapPointProps.selectedId
    const hiddenMapPointCategories = mapPointProps.hiddenCategories

    const mapRevealedRef = useRef(false)
    const [mapOpacity] = useState(() => new Animated.Value(0))
    const [cameraReady, setCameraReady] = useState(false)
    const [loadedStyleSignature, setLoadedStyleSignature] = useState<string | null>(null)
    const {
      selectedHistoryMarker,
      selectedLegalCountry,
      setSelectedHistoryMarker,
      handleSelectLegalCountry,
      dismissHistoryMarker,
      closeLegalCountry,
    } = useMapOverlaySelection(legalLimitsActive)
    const [cameraHeading, setCameraHeading] = useState(0)
    const [cameraZoom, setCameraZoom] = useState<number>(MAP_DEFAULTS.fallbackZoom)
    const { mapViewRef, mapLayout, handleMapLayout, getViewfinderCoordinateFromMap } =
      useMapViewport()
    const {
      gpsFix,
      cameraFix,
      accuracyFix,
      accuracyShape,
      approximateGpsPuckActive,
      directionBearingDeg,
      retainedGpsBearing,
      riderFocusRows,
      mapRiders,
      trackedMapPoints,
      rideRoute,
      liveTrailShape,
      rideRouteShape,
    } = useLiveMapModel({
      liveLocations,
      latestApproximateLocation,
      historyGpsSamples: history.gpsSamples,
      mapPoints,
      selectedMapPointId,
      hiddenMapPointCategories,
      activeNavigationTarget,
      directionPoint,
    })

    const mapStyle = useResolvedMapStyle({
      mapStyleKey: styleProps.mapStyleKey,
      mode,
      satelliteOverlayEnabled: styleProps.satelliteOverlayEnabled,
      satelliteImageryOpacity: styleProps.satelliteImageryOpacity,
      satelliteMapImageryOpacity: styleProps.satelliteMapImageryOpacity,
      satelliteImagerySaturation: styleProps.satelliteImagerySaturation,
      hideTelemetryMapDetails: styleProps.hideTelemetryMapDetails,
      loadedStyleSignature,
    })

    const settingsLoaded = useSettingsStore((s) => s.loaded)
    const lastGpsLatitude = useSettingsStore((s) => s.lastGpsLatitude)
    const lastGpsLongitude = useSettingsStore((s) => s.lastGpsLongitude)
    const historyMetricGradientsEnabled = useSettingsStore((s) => s.historyMetricGradientsEnabled)
    const historyMetricHotRanges = useSettingsStore((s) => s.historyMetricHotRanges)
    const persistedFallback = useMemo(
      () =>
        lastGpsLatitude != null && lastGpsLongitude != null
          ? ([lastGpsLongitude, lastGpsLatitude] as [number, number])
          : null,
      [lastGpsLatitude, lastGpsLongitude],
    )

    const gpsHeadingMode = mapNavigationMode === 'gpsHeading'
    const phoneHeadingMode = mapNavigationMode === 'phoneHeading'
    const phoneHeadingDegRef = useRef<number | null>(null)
    const [phoneHeadingStatus, setPhoneHeadingStatus] = useState<PhoneHeadingStatus | 'idle'>(
      'idle',
    )
    const phoneHeadingAdapter = usePhoneHeadingAdapter()
    const headingFollowMode = gpsHeadingMode || phoneHeadingMode
    useRenderRateWarning('MainMap')
    const followHeadingDeg = gpsHeadingMode
      ? (directionBearingDeg ?? 0)
      : phoneHeadingMode
        ? cameraHeading
        : 0
    const getFollowHeadingDeg = useCallback(
      () =>
        gpsHeadingMode
          ? (directionBearingDeg ?? 0)
          : phoneHeadingMode
            ? (phoneHeadingDegRef.current ?? cameraHeading)
            : 0,
      [cameraHeading, directionBearingDeg, gpsHeadingMode, phoneHeadingMode],
    )

    const {
      cameraRef,
      currentCameraRef,
      engine,
      previewPanActiveRef,
      gpsCamera,
      followGps,
      setFollowGps,
      stopCameraAnimation,
      setFollowZoomLevel,
      recenterLive,
      fitRoute,
      getLiveFollowCamera,
      getHistoryPreviewCamera,
    } = useCameraControls({
      ref,
      cameraFix,
      persistedFallback,
      perspectiveEnabled,
      mapViewport: mapLayout,
      mapNavigationMode,
      heading: {
        gpsMode: headingFollowMode,
        phoneMode: phoneHeadingMode,
        phoneReady: phoneHeadingStatus === 'ready',
        getFollowDeg: getFollowHeadingDeg,
        resetOnRecenter: mapNavigationMode !== 'freeRotate',
      },
      history: {
        active: historyActive,
        selectionKey: history.selectionKey,
        preview: historyPreview,
        previewRoute: history.previewRoute,
        rideRoute,
      },
      follow: {
        updatesEnabled: !(phoneHeadingMode && mode === 'map'),
      },
      getViewfinderCoordinateFromMap,
      onHeadingChange,
      onPerspectiveChange,
    })
    const gpsPuckBearingDeg = getGpsPuckBearing({
      navigationMode: mapNavigationMode,
      approximateFix: approximateGpsPuckActive,
      phoneHeadingDeg: null,
      gpsBearingDeg: directionBearingDeg,
    })
    const displayedCameraHeading = followGps && headingFollowMode ? followHeadingDeg : cameraHeading
    const gpsPinBearingDeg =
      gpsPuckBearingDeg == null ? null : gpsPuckBearingDeg - displayedCameraHeading

    const {
      indicators: offscreenMapIndicators,
      update: updateOffscreenMapIndicators,
      scheduleRefresh: scheduleOffscreenMapIndicatorRefresh,
      repositionForCamera: repositionOffscreenIndicatorsForCamera,
    } = useOffscreenMapIndicators({
      mapViewRef,
      currentCameraRef,
      mapLayout,
      trackedPoints: trackedMapPoints,
      enabled: !historyActive,
    })

    const handlePhoneFollowHeading = useCallback(
      (headingDeg: number) => {
        engine.setTarget({ heading: headingDeg })
      },
      [engine],
    )
    const handlePhoneHeadingChange = useCallback(
      (headingDeg: number | null) => {
        phoneHeadingDegRef.current = headingDeg
        onPhoneHeadingChange(headingDeg)

        if (headingDeg == null || !phoneHeadingMode || !followGps) return
        const currentCamera = currentCameraRef.current
        if (!currentCamera) return

        repositionOffscreenIndicatorsForCamera({ ...currentCamera, heading: headingDeg })
        scheduleOffscreenMapIndicatorRefresh()
      },
      [
        currentCameraRef,
        followGps,
        onPhoneHeadingChange,
        phoneHeadingMode,
        repositionOffscreenIndicatorsForCamera,
        scheduleOffscreenMapIndicatorRefresh,
      ],
    )
    const { handleOffscreenIndicatorPress, handleFocusDirectionPoint } = useMainMapFocusActions({
      engine,
      currentCameraRef,
      historyActive,
      riderFocusRows,
      directionPoint,
      setFollowGps,
      recenterLive,
      onEnterMapMode,
      onMapInteraction,
    })

    useNavigationDiagnosticsSync({
      gpsFix,
      retainedGpsBearing,
      phoneHeadingDegRef,
      phoneHeadingStatus,
      gpsPinBearingDeg,
      displayedCameraHeading,
      mapNavigationMode,
    })

    useEffect(() => {
      if (mapRevealedRef.current) return
      mapOpacity.setValue(0)
      setCameraReady(false)
    }, [gpsCamera.centerCoordinate, mapOpacity])

    useEffect(() => {
      if (!settingsLoaded || !cameraReady) return
      Animated.timing(mapOpacity, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }).start(() => {
        mapRevealedRef.current = true
      })
    }, [cameraReady, mapOpacity, settingsLoaded])

    const { handleMapLoaded, handleCameraChanged, handleMapIdle } = useMainMapCameraEvents({
      cameraRef,
      currentCameraRef,
      engine,
      previewPanActiveRef,
      cameraFix,
      gpsCameraCenter: gpsCamera.centerCoordinate,
      followGps,
      followHeadingDeg,
      headingFollowMode,
      historyActive,
      historyPreview,
      mode,
      perspectiveEnabled,
      phoneHeadingMode,
      mediaAssetCount: history.mediaAssets.length,
      mapStyleKey: styleProps.mapStyleKey,
      mapStyleSignature: mapStyle.styleSignature,
      getHistoryPreviewCamera,
      getLiveFollowCamera,
      setFollowGps,
      setFollowZoomLevel,
      onCameraSettled: mapPointProps.onCameraSettled,
      onHeadingChange,
      repositionOffscreenIndicatorsForCamera,
      scheduleOffscreenMapIndicatorRefresh,
      updateOffscreenMapIndicators,
      setCameraHeading,
      setCameraReady,
      setCameraZoom,
      setLoadedStyleSignature,
    })

    const { handleMapPress, handleLongPress, suppressNextMapPress } = useMapPressHandlers({
      mapViewRef,
      enabled: mode === 'map' && !historyActive,
      onRawMapPress,
      onMapPress,
      onMapInteraction,
      onLongPressTarget,
    })

    useNavigationPathFraming({ active: mode === 'map' && !historyActive, fitRoute })

    const handleTouchStart = useCallback(() => {
      onMapInteraction()
      stopCameraAnimation()
    }, [onMapInteraction, stopCameraAnimation])

    useEffect(() => {
      if (mode === 'telemetry') {
        onOffscreenMapIndicatorsChange(offscreenMapIndicators)
      }
    }, [mode, offscreenMapIndicators, onOffscreenMapIndicatorsChange])

    // Mapbox gives Maestro no idle signal, so a screenshot flow would otherwise have to guess with a
    // sleep and can catch a half-drawn map. Publish the map's own idle event as a waitable marker.
    const [mapSettled, setMapSettled] = useState(false)
    useEffect(() => {
      if (captureMode) setMapSettled(false)
    }, [mode])
    const handleIdle = useCallback(
      (...args: Parameters<typeof handleMapIdle>) => {
        handleMapIdle(...args)
        if (captureMode) setMapSettled(true)
      },
      [handleMapIdle],
    )

    if (!MAPBOX_ACCESS_TOKEN) {
      return <MapUnavailable />
    }

    if (!settingsLoaded) {
      return <MapLoadingPlaceholder />
    }

    return (
      <>
        {captureMode && mapSettled && (
          <View testID="map-settled" collapsable={false} pointerEvents="none" />
        )}
        <MainMapScene
          mapOpacity={mapOpacity}
          onLayout={handleMapLayout}
          onTouchStart={handleTouchStart}
          mapViewRef={mapViewRef}
          cameraRef={cameraRef}
          mapStyle={mapStyle}
          rotationLocked={rotationLocked}
          onDidFinishLoadingMap={handleMapLoaded}
          onPress={handleMapPress}
          onLongPress={handleLongPress}
          onMapIdle={handleIdle}
          onCameraChanged={handleCameraChanged}
          getLiveFollowCamera={getLiveFollowCamera}
          historyActive={historyActive}
          gpsHeadingMode={gpsHeadingMode}
          phoneHeadingMode={phoneHeadingMode}
          followGps={followGps}
          approximateGpsPuckActive={approximateGpsPuckActive}
          accuracyFix={accuracyFix}
          onPhoneFollowHeading={handlePhoneFollowHeading}
          phoneHeadingAdapter={phoneHeadingAdapter}
          onPhoneHeadingChange={handlePhoneHeadingChange}
          onPhoneHeadingStatusChange={setPhoneHeadingStatus}
          mode={mode}
          weatherActive={weatherActive}
          legalLimitsActive={legalLimitsActive}
          liveTrailShape={liveTrailShape}
          rideRouteShape={rideRouteShape}
          accuracyShape={accuracyShape}
          gpsPuckBearingDeg={gpsPuckBearingDeg}
          riders={mapRiders}
          rideRoute={rideRoute}
          history={history}
          cameraZoom={cameraZoom}
          historyMetricGradientsEnabled={historyMetricGradientsEnabled}
          historyMetricHotRanges={historyMetricHotRanges}
          directionPoint={directionPoint}
          activeNavigationTarget={activeNavigationTarget}
          selectedNavigationTarget={selectedNavigationTarget}
          mapPointProps={mapPointProps}
          onSuppressNextMapPress={suppressNextMapPress}
          onSelectMarker={setSelectedHistoryMarker}
          onSelectLegalCountry={handleSelectLegalCountry}
          onFocusDirectionPoint={handleFocusDirectionPoint}
          overlays={{
            selectedHistoryMarker,
            selectedLegalCountry,
            legalLimitsActive,
            weatherActive,
            showOffscreenIndicators: mode !== 'telemetry',
            offscreenMapIndicators,
            onDismissHistoryMarker: dismissHistoryMarker,
            onCloseLegalCountry: closeLegalCountry,
            onOffscreenIndicatorPress: handleOffscreenIndicatorPress,
          }}
        />
      </>
    )
  }),
)
