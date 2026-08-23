import { FillExtrusionLayer, RasterLayer, RasterSource } from '@rnmapbox/maps'

import { MAPY_TILE_URL_TEMPLATE } from '@/config/mapy'
import { theme } from '@/constants/theme'
import { rosterRiderColor } from '@/modules/group-ride/lib/riderColor'
import { useRiderStore } from '@/modules/group-ride/store/riderStore'
import { PrivacyZonesMapLayer } from '@/modules/history/components/PrivacyZonesMapLayer'
import { LegalLimitsMapLayer } from '@/modules/legal/components/LegalLimitsMapLayer'
import { MapPin } from '@/modules/map/components/MapPin'
import { MAP_DEFAULTS } from '@/modules/map/constants/mapStyles'
import { getMapPointKindIcon } from '@/modules/map-points/constants/mapPointIcons'
import { RainViewerOverlay } from '@/modules/weather/components/RainViewerOverlay'
import { HistoryMapLayers } from '@/screens/main/map/HistoryMapLayers'
import { LiveMapLayers } from '@/screens/main/map/LiveMapLayers'
import { MapPointLayers } from '@/screens/main/map/MapPointLayers'
import { NavigationMapLayers } from '@/screens/main/map/NavigationMapLayers'
import {
  DESTINATION_POINT_COLOR,
  DESTINATION_POINT_TEXT_COLOR,
} from '@/screens/main/map/offscreenMapIndicators'
import type { MainMapLayersProps } from '@/screens/main/map/mainMapLayerTypes'

export { HistoryMapLayers }

function BaseTerrainLayers({
  isMapy,
  isOneDark,
  showBuildings3d,
}: Pick<MainMapLayersProps, 'isMapy' | 'isOneDark' | 'showBuildings3d'>) {
  return (
    <>
      {showBuildings3d && (
        <FillExtrusionLayer
          id="center-3d-buildings"
          sourceLayerID="building"
          minZoomLevel={14}
          maxZoomLevel={22}
          style={{
            fillExtrusionColor: isOneDark ? theme.map.buildingDark : theme.map.buildingLight,
            fillExtrusionHeight: ['coalesce', ['get', 'height'], 12],
            fillExtrusionBase: ['coalesce', ['get', 'min_height'], 0],
            fillExtrusionOpacity: isOneDark ? 0.65 : 0.42,
            fillExtrusionVerticalGradient: true,
          }}
        />
      )}
      {isMapy && MAPY_TILE_URL_TEMPLATE ? (
        <RasterSource
          id="center-mapy-tiles"
          tileUrlTemplates={[MAPY_TILE_URL_TEMPLATE]}
          tileSize={256}
          maxZoomLevel={MAP_DEFAULTS.maxZoom}
        >
          <RasterLayer id="center-mapy-tiles-layer" sourceID="center-mapy-tiles" style={{}} />
        </RasterSource>
      ) : null}
    </>
  )
}

/** Rider Direction Points, so the group can see where everyone is heading. */
function RiderTargetPins({ riders }: { riders: MainMapLayersProps['riders'] }) {
  return (
    <>
      {riders.map((rider, index) =>
        rider.presence?.target ? (
          <MapPin
            // Color in the key: PointAnnotation snapshots its children natively, so a
            // color change must remount the pin to re-render.
            key={`center-rider-target-${rider.id}-${rosterRiderColor(rider, index)}`}
            id={`center-rider-target-${rider.id}`}
            coordinate={[rider.presence.target.lng, rider.presence.target.lat]}
            color={rosterRiderColor(rider, index)}
            icon={getMapPointKindIcon('direction')}
          />
        ) : null,
      )}
    </>
  )
}

export function MainMapLayers(props: MainMapLayersProps) {
  const {
    historyActive,
    isMapy,
    isOneDark,
    isSatellite,
    showBuildings3d,
    weatherActive,
    legalLimitsActive,
    riders,
    onSelectLegalCountry,
  } = props
  const riderColor = useRiderStore((state) => state.riderColor)

  return (
    <>
      <BaseTerrainLayers isMapy={isMapy} isOneDark={isOneDark} showBuildings3d={showBuildings3d} />
      <RainViewerOverlay visible={weatherActive} />
      {legalLimitsActive ? <LegalLimitsMapLayer onSelectCountry={onSelectLegalCountry} /> : null}
      <PrivacyZonesMapLayer />
      {historyActive ? (
        <HistoryMapLayers
          rideRouteShape={props.rideRouteShape}
          rideRoute={props.rideRoute}
          rideTelemetrySamples={props.rideTelemetrySamples}
          activeHistoryMapMetric={props.activeHistoryMapMetric}
          rideMarkers={props.rideMarkers}
          rideGpsSamples={props.rideGpsSamples}
          mediaAssets={props.mediaAssets}
          favoriteRanges={props.favoriteRanges}
          mapZoom={props.mapZoom}
          historyMetricGradientsEnabled={props.historyMetricGradientsEnabled}
          historyMetricHotRanges={props.historyMetricHotRanges}
          onSuppressNextMapPress={props.onSuppressNextMapPress}
          onSelectMarker={props.onSelectMarker}
          onOpenMedia={props.onOpenMedia}
          highContrastRoutes={isSatellite}
        />
      ) : (
        <>
          {/* Mapbox paints later style layers above earlier ones. Keep the navigation path before
              every live point so its dots never cross over the GPS puck or heading arrow. */}
          <NavigationMapLayers
            directionPoint={props.directionPoint}
            activeNavigationTarget={props.activeNavigationTarget}
            selectedNavigationTarget={props.selectedNavigationTarget}
            directionColor={riderColor ?? DESTINATION_POINT_COLOR}
            directionTextColor={riderColor ?? DESTINATION_POINT_TEXT_COLOR}
            onFocusDirectionPoint={props.onFocusDirectionPoint}
          />
          <LiveMapLayers
            liveTrailShape={props.liveTrailShape}
            accuracyFix={props.accuracyFix}
            accuracyShape={props.accuracyShape}
            gpsPuckBearingDeg={props.gpsPuckBearingDeg}
            riders={riders}
            highContrastRoutes={isSatellite}
          />
          <RiderTargetPins riders={riders} />
          <MapPointLayers
            mapPoints={props.mapPoints}
            hiddenMapPointCategories={props.hiddenMapPointCategories}
            selectedMapPointId={props.selectedMapPointId}
            activeNavigationTarget={props.activeNavigationTarget}
            expandSelectedMapPoints={props.expandSelectedMapPoints}
            interactive={!weatherActive && !legalLimitsActive}
            onToggleMapPointSelection={props.onToggleMapPointSelection}
            onSuppressNextMapPress={props.onSuppressNextMapPress}
          />
        </>
      )}
    </>
  )
}
