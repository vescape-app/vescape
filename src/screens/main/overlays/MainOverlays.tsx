import { useLayoutEffect, useState, type RefObject } from 'react'
import { useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { MapPoint, MapPointPatch } from 'vescape-core'

import type { Board } from '@/modules/board/store/boardStore'
import { LegalLimitsMapOverlay } from '@/modules/legal/components/LegalLimitsMapOverlay'
import type { MapOrientationMode, MapStyleKey } from '@/modules/map/constants/mapStyles'
import type { MapSelection } from '@/modules/map/lib/mapSelection'
import type { DirectionPoint } from '@/modules/map/store/mapStore'
import { WeatherMapOverlay } from '@/modules/weather/components/WeatherMapOverlay'
import { HistoryOverlay, type MainHistoryOverlayProps } from '@/screens/main/history/HistoryOverlay'
import { type MainMapHandle } from '@/screens/main/map/MainMap'
import { MapControls } from '@/screens/main/map/MapControls'
import { MapModeOverlay } from '@/screens/main/map/MapModeOverlay'
import { MapModeTabs } from '@/screens/main/map/MapModeTabs'
import { MapVignette } from '@/screens/main/map/MapVignette'
import type { OffscreenMapIndicatorState } from '@/screens/main/map/offscreenMapIndicators'
import type { MapSelector } from '@/screens/main/mainScreenStore'
import type { MainViewState } from '@/screens/main/mainViewState'
import { MapPointStatusBanner } from '@/modules/map-points/components/MapPointStatusBanner'
import { STRIP_CONTENT_HEIGHT } from '@/screens/main/overlays/BottomTelemetryStrip'
import { TelemetryOverlay } from '@/screens/main/overlays/TelemetryOverlay'

const TELEMETRY_FADE_TIMING = { duration: 260 } as const

interface MainBoardOverlayProps {
  boards: Board[]
  activeBoardId: string | null
  activeBoard: Board | undefined
  bleStatus: string
  onStopScan: () => void
  onRetryConnect: () => void
  onSelectBoard: (id: string) => void
  onAddBoard: () => void
}

interface MainMapOverlayProps {
  heading: SharedValue<number>
  mapStyleKey: MapStyleKey
  setMapStyleKey: (key: MapStyleKey) => void
  mapOrientationMode: MapOrientationMode
  setMapOrientationMode: (mode: MapOrientationMode) => void
  mapSelector: MapSelector
  setMapSelector: (selector: MapSelector) => void
  enterMapFocus: () => void
  exitMapFocus: () => void
  enterWeather: () => void
  exitWeather: () => void
  enterLegalLimits: () => void
  exitLegalLimits: () => void
  weatherLocation: { latitude: number; longitude: number } | null
  directionPoint: DirectionPoint | null
  activeNavigationTarget: MapSelection | null
  selectedNavigationTarget: MapSelection | null
  longPressMapTarget: MapSelection | null
  onLongPressMapTargetHandled: () => void
  onSelectNavigationTarget: (selection: MapSelection) => void
  onNavigateTarget: (selection: MapSelection) => Promise<void>
  onNavigateSelectedTarget: () => Promise<void>
  onCancelNavigation: () => void
  onDismissSelectedTarget: () => void
  updateMapPoint: (id: string, patch: MapPointPatch) => Promise<MapPoint | null>
  setMapPointReaction: (id: string, reaction: 'up' | 'down' | null) => void
  onRemoveMapPoint: (id: string) => void
  offscreenMapIndicators: OffscreenMapIndicatorState[]
  onOffscreenIndicatorPress: (indicator: OffscreenMapIndicatorState) => void
}

interface MainOverlaysProps {
  mode: MainViewState
  mapRef: RefObject<MainMapHandle | null>
  mapInteractionHandlerRef: RefObject<(selection?: MapSelection) => boolean | void>
  board: MainBoardOverlayProps
  map: MainMapOverlayProps
  history: MainHistoryOverlayProps & { enterHistoryMode: () => void }
}

/**
 * Everything drawn on top of the map. One overlay per mode, each owning its own state; this only
 * decides which of them is on screen and holds the few values two modes share.
 */
export function MainOverlays({
  mode,
  mapRef,
  mapInteractionHandlerRef,
  board,
  map,
  history,
}: MainOverlaysProps) {
  const insets = useSafeAreaInsets()
  const [panelHeight, setPanelHeight] = useState(0)
  // Owned here because the telemetry drag fades the map vignette as well as the telemetry face.
  const revealProgress = useSharedValue(0)
  const dragOpacity = useSharedValue(0)

  // Coming back to telemetry undoes whatever the reveal drag left behind.
  useLayoutEffect(() => {
    if (mode !== 'telemetry') return
    revealProgress.value = 0
    dragOpacity.value = withTiming(0, TELEMETRY_FADE_TIMING)
  }, [dragOpacity, mode, revealProgress])

  const aboveStripBottom = STRIP_CONTENT_HEIGHT + Math.max(insets.bottom * 0.5, 8) + 8
  const mapModeTabsTop = Math.max(insets.top, 8)
  const belowMapModeTabsTop = mapModeTabsTop + 48
  const mapTargetBottom = Math.max(insets.bottom, 16) + 16
  const isMapMode = mode === 'map' || mode === 'weather' || mode === 'legalLimits'

  return (
    <>
      <MapVignette
        mode={mode}
        panelHeight={mode === 'history' && history.selectedSession ? panelHeight : 0}
        visible
        fadeOutProgress={dragOpacity}
      />

      <TelemetryOverlay
        mode={mode}
        mapRef={mapRef}
        revealProgress={revealProgress}
        dragOpacity={dragOpacity}
        boards={board.boards}
        activeBoardId={board.activeBoardId}
        activeBoard={board.activeBoard}
        bleStatus={board.bleStatus}
        offscreenMapIndicators={map.offscreenMapIndicators}
        onSelectBoard={board.onSelectBoard}
        onAddBoard={board.onAddBoard}
        onStopScan={board.onStopScan}
        onRetryConnect={board.onRetryConnect}
        onEnterMapFocus={map.enterMapFocus}
        onEnterWeather={map.enterWeather}
        onEnterLegalLimits={map.enterLegalLimits}
        onEnterHistory={() => void history.enterHistoryMode()}
        onOffscreenIndicatorPress={map.onOffscreenIndicatorPress}
        activeNavigationTarget={map.activeNavigationTarget}
        onCancelNavigation={map.onCancelNavigation}
      />

      {isMapMode ? (
        <MapModeTabs
          mode={mode}
          top={mapModeTabsTop}
          onEnterMap={map.enterMapFocus}
          onEnterWeather={map.enterWeather}
          onEnterLegalLimits={map.enterLegalLimits}
        />
      ) : null}

      {mode === 'map' ? <MapPointStatusBanner top={belowMapModeTabsTop} /> : null}

      <MapModeOverlay
        visible={mode === 'map'}
        mapRef={mapRef}
        mapInteractionHandlerRef={mapInteractionHandlerRef}
        top={mapModeTabsTop}
        bottom={aboveStripBottom - 112}
        sheetBottom={mapTargetBottom}
        searchProximity={map.weatherLocation}
        directionPoint={map.directionPoint}
        activeNavigationTarget={map.activeNavigationTarget}
        selectedNavigationTarget={map.selectedNavigationTarget}
        longPressMapTarget={map.longPressMapTarget}
        onExit={map.exitMapFocus}
        onLongPressMapTargetHandled={map.onLongPressMapTargetHandled}
        onSelectNavigationTarget={map.onSelectNavigationTarget}
        onNavigateTarget={map.onNavigateTarget}
        onNavigateSelectedTarget={map.onNavigateSelectedTarget}
        onCancelNavigation={map.onCancelNavigation}
        onDismissSelectedTarget={map.onDismissSelectedTarget}
        updateMapPoint={map.updateMapPoint}
        setMapPointReaction={map.setMapPointReaction}
        onRemoveMapPoint={map.onRemoveMapPoint}
      />

      <MapControls
        mode={mode}
        mapRef={mapRef}
        heading={map.heading}
        mapStyleKey={map.mapStyleKey}
        setMapStyleKey={map.setMapStyleKey}
        mapOrientationMode={map.mapOrientationMode}
        setMapOrientationMode={map.setMapOrientationMode}
        mapSelector={map.mapSelector}
        setMapSelector={map.setMapSelector}
      />

      <WeatherMapOverlay
        visible={mode === 'weather'}
        top={mapModeTabsTop}
        pillTop={belowMapModeTabsTop}
        onExit={map.exitWeather}
      />

      <LegalLimitsMapOverlay
        visible={mode === 'legalLimits'}
        top={mapModeTabsTop}
        onExit={map.exitLegalLimits}
      />

      <HistoryOverlay
        visible={mode === 'history'}
        history={history}
        panelHeight={panelHeight}
        onPanelHeightChange={setPanelHeight}
      />
    </>
  )
}
