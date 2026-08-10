import {
  ChargingStationIcon,
  EyeIcon,
  FlagIcon,
  MapPinIcon,
  type Icon,
} from 'phosphor-react-native'
import type { MapPinKind } from '@/modules/map-points/constants/mapPoints'

import {
  BonkMapPointIcon,
  DropMapPointIcon,
  SlideMapPointIcon,
} from '@/modules/map-points/components/MapPointSvgIcons'

const MAP_POINT_KIND_ICONS: Record<MapPinKind, Icon> = {
  // The pin, the same one the target sheet's header shows: the rider looks between the map and the
  // sheet while deciding on a path, and two icons for one Direction Point read as two things.
  direction: MapPinIcon,
  drop: DropMapPointIcon,
  bonk: BonkMapPointIcon,
  nose_slide: SlideMapPointIcon,
  trail_entry: FlagIcon,
  viewpoint: EyeIcon,
  charging: ChargingStationIcon,
}

export function getMapPointKindIcon(kind: MapPinKind) {
  return MAP_POINT_KIND_ICONS[kind]
}
