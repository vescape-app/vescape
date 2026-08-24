import Mapbox, { Camera } from '@rnmapbox/maps'
import type { ComponentProps, ComponentRef, RefObject } from 'react'
import { Animated, StyleSheet } from 'react-native'

import { PhoneHeadingMapLayer } from '@/modules/map/components/PhoneHeadingMapLayer'
import { MAP_DEFAULTS } from '@/modules/map/constants/mapStyles'
import type { MainViewState } from '@/screens/main/mainViewState'
import { MainMapLayers } from '@/screens/main/map/MainMapLayers'
import { MainMapOverlays } from '@/screens/main/map/MainMapOverlays'
import { MapBaseStyleLayers } from '@/screens/main/map/MapBaseStyleLayers'
import { SatelliteImageryLayer } from '@/screens/main/map/SatelliteImageryLayer'
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
        {mapStyle.isSatelliteOverlay && (
          <SatelliteImageryLayer paint={mapStyle.satelliteImageryPaint} />
        )}
        <MapBaseStyleLayers
          enabled={mapStyle.canUpdateExistingStyleLayers}
          styleKey={mapStyle.styleKey}
          isOneDark={mapStyle.isOneDark}
          isSatellite={mapStyle.isSatellite}
          isSatelliteOverlay={mapStyle.isSatelliteOverlay}
          mapDetailsVisible={mapStyle.mapDetailsVisible}
          satelliteRoadLineOpacity={mapStyle.satelliteRoadLineOpacity}
        />
        <PhoneHeadingMapLayer
          active={!historyActive && !gpsHeadingMode}
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
})
