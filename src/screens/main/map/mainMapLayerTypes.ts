import type { SharedValue } from 'react-native-reanimated'
import type { MapPoint, MapPointCategory } from 'vescape-core'

import type { makeCircleFeature, makeTrailLineString } from '@/helpers/mapGeometry'
import type { RosterRider } from '@/modules/group-ride/lib/roster'
import type { MapPose } from '@/modules/map/components/GpsPuck'
import type { MediaHistoryAsset } from '@/modules/history/lib/mediaHistory'
import type {
  HistoryMetricHotRanges,
  HistoryMetricKey,
} from '@/modules/history/lib/metricColorScale'
import type { SelectedHistoryMarker } from '@/modules/history/lib/historyMapMarkerInfo'
import type {
  HistoryGpsSample,
  HistoryMarker,
  TelemetrySample,
} from '@/modules/history/store/historyStore'
import type { LegalLimitCountry } from '@/modules/legal/lib/legalLimits'
import type { MapSelection } from '@/modules/map/lib/mapSelection'
import type { DirectionPoint } from '@/modules/map/store/mapStore'

export interface MainMapLayersProps {
  historyActive: boolean
  expandSelectedMapPoints: boolean
  isSatellite: boolean
  /** First label layer of the loaded style; app fill layers go below it. */
  fillBeforeId?: string
  weatherActive: boolean
  legalLimitsActive: boolean
  liveTrailShape: ReturnType<typeof makeTrailLineString> | null
  rideRouteShape: {
    type: 'Feature'
    geometry: { type: 'LineString'; coordinates: [number, number][] }
    properties: Record<string, never>
  } | null
  accuracyFix: { longitude: number; latitude: number } | null
  accuracyShape: ReturnType<typeof makeCircleFeature> | null
  /** The puck arrow's map bearing — GPS course or phone compass; null hides the arrow. */
  puckBearing: SharedValue<number | null>
  mapPose: SharedValue<MapPose>
  riders: RosterRider[]
  rideRoute: [number, number][]
  rideTelemetrySamples: TelemetrySample[]
  activeHistoryMapMetric: HistoryMetricKey
  rideMarkers: HistoryMarker[]
  rideGpsSamples: HistoryGpsSample[]
  mediaAssets: MediaHistoryAsset[]
  favoriteRanges: { startMs: number; endMs: number }[]
  mapZoom: number
  historyMetricGradientsEnabled: boolean
  historyMetricHotRanges: HistoryMetricHotRanges
  directionPoint: DirectionPoint | null
  activeNavigationTarget: MapSelection | null
  selectedNavigationTarget: MapSelection | null
  mapPoints: MapPoint[]
  selectedMapPointId: string | null
  hiddenMapPointCategories: MapPointCategory[]
  onToggleMapPointSelection: (id: string) => void
  onSuppressNextMapPress: () => void
  onSelectMarker: (selection: SelectedHistoryMarker) => void
  onOpenMedia: (asset: MediaHistoryAsset) => void
  onSelectLegalCountry: (country: LegalLimitCountry) => void
  onFocusDirectionPoint: () => void
}
