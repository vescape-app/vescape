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
