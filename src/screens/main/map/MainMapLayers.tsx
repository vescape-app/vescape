import { useResolvedAccentColors } from '@/hooks/useTheme'
import { riderMapColor } from '@/modules/group-ride/lib/riderColor'
import { MapPin } from '@/modules/map/components/MapPin'
import { getMapPointKindIcon } from '@/modules/map-points/constants/mapPointIcons'
import { HistoryMapLayers } from '@/screens/main/map/HistoryMapLayers'
import { LiveMapLayers } from '@/screens/main/map/LiveMapLayers'
import { MapPointLayers } from '@/screens/main/map/MapPointLayers'
import type { MainMapLayersProps } from '@/screens/main/map/mainMapLayerTypes'

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
  const { historyActive, isSatellite, weatherActive, legalLimitsActive, riders } = props

  return (
    <>
      {/* TODO(maplibre phase 2): RainViewerOverlay */}
      {/* TODO(maplibre phase 2): RadarRangeRings */}
      {/* TODO(maplibre phase 2): LegalLimitsMapLayer */}
      {/* TODO(maplibre phase 2): PrivacyZonesMapLayer */}
      {historyActive ? null /* TODO(maplibre phase 2): HistoryMapLayers */ : (
        <>
          {/* TODO(maplibre phase 2): NavigationMapLayers */}
          <LiveMapLayers
            liveTrailShape={props.liveTrailShape}
            accuracyFix={props.accuracyFix}
            accuracyShape={props.accuracyShape}
            puckBearing={props.puckBearing}
            mapPose={props.mapPose}
            fillBeforeId={props.fillBeforeId}
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
