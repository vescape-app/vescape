import Mapbox, { Camera } from '@rnmapbox/maps'
import type { ComponentProps, ComponentRef, RefObject } from 'react'
import { ActivityIndicator, Animated, Pressable, StyleSheet, Text, View } from 'react-native'

import { theme } from '@/constants/theme'
import { PhoneHeadingMapLayer } from '@/modules/map/components/PhoneHeadingMapLayer'
import { MAP_DEFAULTS } from '@/modules/map/constants/mapStyles'
import type { MainViewState } from '@/screens/main/mainViewState'
import { MainMapLayers } from '@/screens/main/map/MainMapLayers'
import { MainMapOverlays } from '@/screens/main/map/MainMapOverlays'
import { MapBaseStyleLayers } from '@/screens/main/map/MapBaseStyleLayers'
import type { MainMapHistoryProps, MainMapPointsProps } from '@/screens/main/map/MainMap'
import type { CameraSnapshot } from '@/screens/main/map/useCameraControls'
import type { useResolvedMapStyle } from '@/screens/main/map/useResolvedMapStyle'

type LayerProps = ComponentProps<typeof MainMapLayers>
type OverlayProps = ComponentProps<typeof MainMapOverlays>
type MapViewProps = ComponentProps<typeof Mapbox.MapView>

interface MainMapSceneProps {
  mapOpacity: Animated.Value
  onLayout: ComponentProps<typeof Animated.View>['onLayout']
  onTouchStart: ComponentProps<typeof Animated.View>['onTouchStart']
  mapViewRef: RefObject<ComponentRef<typeof Mapbox.MapView> | null>
  cameraRef: RefObject<Camera | null>
  mapStyle: ReturnType<typeof useResolvedMapStyle>
  rotationLocked: boolean
  onDidFinishLoadingMap: MapViewProps['onDidFinishLoadingMap']
  onMapLoadingError: MapViewProps['onMapLoadingError']
  mapLoading: boolean
  mapLoadFailed: boolean
  onRetryStyleLoad: () => void
  styleRetryNonce: number
  onPress: MapViewProps['onPress']
  onLongPress: MapViewProps['onLongPress']
  onMapIdle: MapViewProps['onMapIdle']
  onCameraChanged: MapViewProps['onCameraChanged']
  getLiveFollowCamera: () => CameraSnapshot
  historyActive: boolean
  gpsHeadingMode: boolean
  phoneHeadingMode: boolean
  followGps: boolean
  accuracyFix: LayerProps['accuracyFix']
  onPhoneFollowHeading: ComponentProps<typeof PhoneHeadingMapLayer>['onFollowHeading']
  phoneHeadingAdapter: ComponentProps<typeof PhoneHeadingMapLayer>['adapter']
  onPhoneHeadingChange: ComponentProps<typeof PhoneHeadingMapLayer>['onHeadingChange']
  onPhoneHeadingStatusChange: ComponentProps<typeof PhoneHeadingMapLayer>['onStatusChange']
  mode: MainViewState
  weatherActive: boolean
  legalLimitsActive: boolean
  liveTrailShape: LayerProps['liveTrailShape']
  rideRouteShape: LayerProps['rideRouteShape']
  accuracyShape: LayerProps['accuracyShape']
  gpsPuckBearingDeg: LayerProps['gpsPuckBearingDeg']
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
  rotationLocked,
  onDidFinishLoadingMap,
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
  gpsHeadingMode,
  phoneHeadingMode,
  followGps,
  accuracyFix,
  onPhoneFollowHeading,
  phoneHeadingAdapter,
  onPhoneHeadingChange,
  onPhoneHeadingStatusChange,
  mode,
  weatherActive,
  legalLimitsActive,
  liveTrailShape,
  rideRouteShape,
  accuracyShape,
  gpsPuckBearingDeg,
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
      <Mapbox.MapView
        key={styleRetryNonce}
        ref={mapViewRef}
        style={styles.map}
        styleURL={mapStyle.styleURL}
        styleJSON={mapStyle.styleJSON}
        pitchEnabled={false}
        rotateEnabled={!rotationLocked}
        compassEnabled={false}
        scaleBarEnabled={false}
        logoEnabled={mapStyle.mapDetailsVisible}
        logoPosition={{ bottom: 8, left: 8 }}
        attributionEnabled={mapStyle.mapDetailsVisible}
        attributionPosition={{ bottom: 8, left: 92 }}
        onDidFinishLoadingMap={onDidFinishLoadingMap}
        onMapLoadingError={onMapLoadingError}
        onPress={onPress}
        onLongPress={onLongPress}
        onMapIdle={onMapIdle}
        onCameraChanged={onCameraChanged}
      >
        <Camera
          ref={cameraRef}
          defaultSettings={{ ...getLiveFollowCamera() }}
          maxZoomLevel={MAP_DEFAULTS.maxZoom}
          animationMode="easeTo"
        />
        <MapBaseStyleLayers
          enabled={mapStyle.canUpdateExistingStyleLayers}
          styleKey={mapStyle.styleKey}
          isOneDark={mapStyle.isOneDark}
          isSatellite={mapStyle.isSatellite}
          isSatelliteOverlay={mapStyle.isSatelliteOverlay}
          mapDetailsVisible={mapStyle.mapDetailsVisible}
          satelliteImageryPaint={mapStyle.satelliteImageryPaint}
          satelliteRoadLineOpacity={mapStyle.satelliteRoadLineOpacity}
        />
        <PhoneHeadingMapLayer
          active={!historyActive && !gpsHeadingMode}
          adapter={phoneHeadingAdapter}
          followCamera={phoneHeadingMode && followGps}
          coordinate={accuracyFix}
          onFollowHeading={onPhoneFollowHeading}
          onHeadingChange={onPhoneHeadingChange}
          onStatusChange={onPhoneHeadingStatusChange}
        />
        <MainMapLayers
          historyActive={historyActive}
          expandSelectedMapPoints={mode === 'map'}
          isMapy={mapStyle.isMapy}
          isOneDark={mapStyle.isOneDark}
          isSatellite={mapStyle.isSatelliteOverlay}
          showBuildings3d={mapStyle.showBuildings3d}
          weatherActive={weatherActive}
          legalLimitsActive={legalLimitsActive}
          liveTrailShape={liveTrailShape}
          rideRouteShape={rideRouteShape}
          accuracyFix={accuracyFix}
          accuracyShape={accuracyShape}
          gpsPuckBearingDeg={gpsPuckBearingDeg}
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
      </Mapbox.MapView>
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
