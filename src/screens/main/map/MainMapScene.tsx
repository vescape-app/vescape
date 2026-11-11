import {
  Camera,
  Map as MapLibreMap,
  type CameraRef,
  type MapRef,
} from '@maplibre/maplibre-react-native'
import { Fragment, type ComponentProps, type RefObject } from 'react'
import { ActivityIndicator, Animated, Pressable, StyleSheet, Text, View } from 'react-native'

import { theme } from '@/constants/theme'
import { MAP_DEFAULTS } from '@/modules/map/constants/mapStyles'
import type { MainViewState } from '@/screens/main/mainViewState'
import { MainMapLayers } from '@/screens/main/map/MainMapLayers'
import { MainMapOverlays } from '@/screens/main/map/MainMapOverlays'
import type { MainMapHistoryProps, MainMapPointsProps } from '@/screens/main/map/MainMap'
import type { CameraSnapshot } from '@/screens/main/map/useCameraControls'
import { toDirectCamera } from '@/modules/map/lib/directCamera'
import type { MapStyleDocument } from '@/screens/main/map/mapStyleLifecycle'
import type { useResolvedMapStyle } from '@/screens/main/map/useResolvedMapStyle'

type LayerProps = ComponentProps<typeof MainMapLayers>
type OverlayProps = ComponentProps<typeof MainMapOverlays>
type MapViewProps = ComponentProps<typeof MapLibreMap>

interface MainMapSceneProps {
  mapOpacity: Animated.Value
  onLayout: ComponentProps<typeof Animated.View>['onLayout']
  onTouchStart: ComponentProps<typeof Animated.View>['onTouchStart']
  mapViewRef: RefObject<MapRef | null>
  cameraRef: RefObject<CameraRef | null>
  mapStyle: ReturnType<typeof useResolvedMapStyle>
  appliedStyle: MapStyleDocument
  styleReady: boolean
  rotationLocked: boolean
  onDidFinishLoadingStyle: MapViewProps['onDidFinishLoadingStyle']
  onMapLoadingError: MapViewProps['onDidFailLoadingMap']
  mapLoading: boolean
  mapLoadFailed: boolean
  onRetryStyleLoad: () => void
  styleRetryNonce: number
  onPress: MapViewProps['onPress']
  onLongPress: MapViewProps['onLongPress']
  onMapIdle: MapViewProps['onDidFinishRenderingMapFully']
  onCameraChanged: MapViewProps['onRegionIsChanging']
  getLiveFollowCamera: () => CameraSnapshot
  historyActive: boolean
  accuracyFix: LayerProps['accuracyFix']
  mode: MainViewState
  weatherActive: boolean
  legalLimitsActive: boolean
  liveTrailShape: LayerProps['liveTrailShape']
  rideRouteShape: LayerProps['rideRouteShape']
  accuracyShape: LayerProps['accuracyShape']
  puckBearing: LayerProps['puckBearing']
  mapPose: LayerProps['mapPose']
  riders: LayerProps['riders']
  rideRoute: LayerProps['rideRoute']
  history: MainMapHistoryProps
  cameraZoom: number
  historyMetricGradientsEnabled: boolean
  historyMetricHotRanges: LayerProps['historyMetricHotRanges']
  directionPoint: LayerProps['directionPoint']
  activeNavigationTarget: LayerProps['activeNavigationTarget']
  selectedNavigationTarget: LayerProps['selectedNavigationTarget']
  mapPointProps: MainMapPointsProps
  onSuppressNextMapPress: LayerProps['onSuppressNextMapPress']
  onSelectMarker: LayerProps['onSelectMarker']
  onSelectLegalCountry: LayerProps['onSelectLegalCountry']
  onFocusDirectionPoint: LayerProps['onFocusDirectionPoint']
  overlays: OverlayProps
}

export function MainMapScene({
  mapOpacity,
  onLayout,
  onTouchStart,
  mapViewRef,
  cameraRef,
  mapStyle,
  appliedStyle,
  styleReady,
  rotationLocked,
  onDidFinishLoadingStyle,
  onMapLoadingError,
  mapLoading,
  mapLoadFailed,
  onRetryStyleLoad,
  styleRetryNonce,
  onPress,
  onLongPress,
  onMapIdle,
  onCameraChanged,
  getLiveFollowCamera,
  historyActive,
  accuracyFix,
  mode,
  weatherActive,
  legalLimitsActive,
  liveTrailShape,
  rideRouteShape,
  accuracyShape,
  puckBearing,
  mapPose,
  riders,
  rideRoute,
  history,
  cameraZoom,
  historyMetricGradientsEnabled,
  historyMetricHotRanges,
  directionPoint,
  activeNavigationTarget,
  selectedNavigationTarget,
  mapPointProps,
  onSuppressNextMapPress,
  onSelectMarker,
  onSelectLegalCountry,
  onFocusDirectionPoint,
  overlays,
}: MainMapSceneProps) {
  return (
    <Animated.View
      style={[styles.container, { opacity: mapOpacity }]}
      onLayout={onLayout}
      onTouchStart={onTouchStart}
    >
      <MapLibreMap
        // Style swaps stay inside the existing native map so its camera, renderer, and tile cache
        // survive. An explicit retry still recreates a map whose loader entered a failed state.
        key={styleRetryNonce}
        ref={mapViewRef}
        style={styles.map}
        mapStyle={appliedStyle.mapStyle}
        touchPitch={false}
        touchRotate={!rotationLocked}
        compass={false}
        scaleBar={false}
        logo={mapStyle.mapDetailsVisible}
        logoPosition={{ bottom: 8, left: 8 }}
        attribution={mapStyle.mapDetailsVisible}
        attributionPosition={{ bottom: 8, left: 92 }}
        onDidFinishLoadingStyle={onDidFinishLoadingStyle}
        onDidFailLoadingMap={onMapLoadingError}
        onPress={onPress}
        onLongPress={onLongPress}
        // Rendered fully with nothing pending: the map's idle, after a gesture or an engine move.
        onDidFinishRenderingMapFully={onMapIdle}
        onRegionIsChanging={onCameraChanged}
      >
        <Camera
          ref={cameraRef}
          initialViewState={initialViewState(getLiveFollowCamera())}
          maxZoom={MAP_DEFAULTS.maxZoom}
        />
        {styleReady && (
          // Native styles own their sources and layers. Mount a fresh React layer tree only after
          // the replacement document is ready; never update nodes the previous style removed.
          <Fragment key={mapStyle.styleSignature}>
            <MainMapLayers
              historyActive={historyActive}
              expandSelectedMapPoints={mode === 'map'}
              isSatellite={mapStyle.isSatellite}
              fillBeforeId={mapStyle.fillBeforeId}
              weatherActive={weatherActive}
              legalLimitsActive={legalLimitsActive}
              liveTrailShape={liveTrailShape}
              rideRouteShape={rideRouteShape}
              accuracyFix={accuracyFix}
              accuracyShape={accuracyShape}
              puckBearing={puckBearing}
              mapPose={mapPose}
              riders={riders}
              rideRoute={rideRoute}
              rideTelemetrySamples={history.telemetrySamples}
              activeHistoryMapMetric={history.activeMapMetric}
              rideMarkers={history.markers}
              rideGpsSamples={history.gpsSamples}
              mediaAssets={history.mediaAssets}
              favoriteRanges={history.favoriteRanges}
              mapZoom={cameraZoom}
              historyMetricGradientsEnabled={historyMetricGradientsEnabled}
              historyMetricHotRanges={historyMetricHotRanges}
              directionPoint={directionPoint}
              activeNavigationTarget={activeNavigationTarget}
              selectedNavigationTarget={selectedNavigationTarget}
              mapPoints={mapPointProps.points}
              selectedMapPointId={mapPointProps.selectedId}
              hiddenMapPointCategories={mapPointProps.hiddenCategories}
              onToggleMapPointSelection={mapPointProps.onToggleSelection}
              onSuppressNextMapPress={onSuppressNextMapPress}
              onSelectMarker={onSelectMarker}
              onOpenMedia={history.onOpenMedia}
              onSelectLegalCountry={onSelectLegalCountry}
              onFocusDirectionPoint={onFocusDirectionPoint}
            />
          </Fragment>
        )}
      </MapLibreMap>
      <MainMapOverlays {...overlays} />
      {mapLoading && !mapLoadFailed && (
        <View style={styles.styleLoading} pointerEvents="none">
          <ActivityIndicator size="small" color={theme.neutral.textMuted} />
        </View>
      )}
      {mapLoadFailed && (
        <View style={styles.styleLoadFailed}>
          <Text style={styles.styleLoadFailedTitle}>Map style failed to load</Text>
          <Pressable
            onPress={onRetryStyleLoad}
            style={({ pressed }) => [
              styles.styleLoadFailedButton,
              pressed && styles.styleLoadFailedButtonPressed,
            ]}
          >
            <Text style={styles.styleLoadFailedButtonText}>Retry</Text>
          </Pressable>
        </View>
      )}
    </Animated.View>
  )
}

function initialViewState(camera: CameraSnapshot) {
  return {
    ...toDirectCamera({
      zoom: camera.zoomLevel,
      heading: camera.heading,
      pitch: camera.pitch,
      padding: camera.padding,
    }),
    center: camera.centerCoordinate,
  }
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFill,
  },
  map: {
    ...StyleSheet.absoluteFill,
  },
  styleLoading: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.alpha(theme.palette.mono.black, 0.3),
  },
  styleLoadFailed: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.alpha(theme.palette.mono.black, 0.6),
    paddingHorizontal: 28,
  },
  styleLoadFailedTitle: {
    color: theme.palette.mono.white,
    fontSize: 16,
    fontWeight: '600',
  },
  styleLoadFailedButton: {
    marginTop: 16,
    backgroundColor: theme.neutral.surfaceDeep,
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 10,
  },
  styleLoadFailedButtonPressed: {
    opacity: 0.7,
  },
  styleLoadFailedButtonText: {
    color: theme.neutral.textPrimary,
    fontSize: 14,
    fontWeight: '600',
  },
})
