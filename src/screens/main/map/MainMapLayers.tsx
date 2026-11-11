import { useResolvedAccentColors } from '@/hooks/useTheme'
import { riderMapColor } from '@/modules/group-ride/lib/riderColor'
import { useSelectedBoardRailColor } from '@/modules/group-ride/lib/selectedBoardRailColor'
import { PrivacyZonesMapLayer } from '@/modules/history/components/PrivacyZonesMapLayer'
import { LegalLimitsMapLayer } from '@/modules/legal/components/LegalLimitsMapLayer'
import { MapPin } from '@/modules/map/components/MapPin'
import { getMapPointKindIcon } from '@/modules/map-points/constants/mapPointIcons'
import { useSettingsStore } from '@/modules/settings/store/settingsStore'
import { RadarRangeRings } from '@/modules/weather/components/RadarRangeRings'
import { RainViewerOverlay } from '@/modules/weather/components/RainViewerOverlay'
import { HistoryMapLayers } from '@/screens/main/map/HistoryMapLayers'
import { LiveMapLayers } from '@/screens/main/map/LiveMapLayers'
import { MapPointLayers } from '@/screens/main/map/MapPointLayers'
import { NAVIGATION_ROUTE_COLOR, NavigationMapLayers } from '@/screens/main/map/NavigationMapLayers'
import {
  DESTINATION_POINT_COLOR,
  DESTINATION_POINT_TEXT_COLOR,
} from '@/screens/main/map/offscreenMapIndicators'
import type { MainMapLayersProps } from '@/screens/main/map/mainMapLayerTypes'

// Ride History Markers are diagnostic detail; the history route stays clean unless they are opted in.
const NO_MARKERS: MainMapLayersProps['rideMarkers'] = []

export { HistoryMapLayers }

/** Rider Direction Points, so the group can see where everyone is heading. */
function RiderTargetPins({ riders }: { riders: MainMapLayersProps['riders'] }) {
  const accents = useResolvedAccentColors()
  return (
    <>
      {riders.map((rider) => {
        if (!rider.presence?.target) return null
        return (
          <MapPin
            key={`center-rider-target-${rider.id}`}
            id={`center-rider-target-${rider.id}`}
            coordinate={[rider.presence.target.lng, rider.presence.target.lat]}
            color={riderMapColor(rider, accents)}
            icon={getMapPointKindIcon('direction')}
          />
        )
      })}
    </>
  )
}

export function MainMapLayers(props: MainMapLayersProps) {
  const {
    historyActive,
    isSatellite,
    weatherActive,
    legalLimitsActive,
    riders,
    fillBeforeId,
    onSelectLegalCountry,
  } = props
  const riderColor = useSelectedBoardRailColor()
  const showHistoryMapMarkers = useSettingsStore((state) => state.showHistoryMapMarkers)

  return (
    <>
      <RainViewerOverlay visible={weatherActive} />
      <RadarRangeRings visible={weatherActive} fix={props.accuracyFix} />
      {legalLimitsActive ? (
        <LegalLimitsMapLayer fillBeforeId={fillBeforeId} onSelectCountry={onSelectLegalCountry} />
      ) : null}
      <PrivacyZonesMapLayer fillBeforeId={fillBeforeId} />
      {historyActive ? (
        <HistoryMapLayers
          rideRouteShape={props.rideRouteShape}
          rideRoute={props.rideRoute}
          rideTelemetrySamples={props.rideTelemetrySamples}
          activeHistoryMapMetric={props.activeHistoryMapMetric}
          rideMarkers={showHistoryMapMarkers ? props.rideMarkers : NO_MARKERS}
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
          {/* Mounted before the live layers so its dots stay under the live trail. */}
          <NavigationMapLayers
            directionPoint={props.directionPoint}
            activeNavigationTarget={props.activeNavigationTarget}
            selectedNavigationTarget={props.selectedNavigationTarget}
            directionColor={riderColor ?? DESTINATION_POINT_COLOR}
            directionTextColor={riderColor ?? DESTINATION_POINT_TEXT_COLOR}
            routeColor={riderColor ?? NAVIGATION_ROUTE_COLOR}
            onFocusDirectionPoint={props.onFocusDirectionPoint}
          />
          <LiveMapLayers
            liveTrailShape={props.liveTrailShape}
            accuracyFix={props.accuracyFix}
            accuracyShape={props.accuracyShape}
            puckBearing={props.puckBearing}
            mapPose={props.mapPose}
            fillBeforeId={fillBeforeId}
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
