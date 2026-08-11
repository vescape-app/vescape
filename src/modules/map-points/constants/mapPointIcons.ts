import {
  AirplaneIcon,
  BankIcon,
  BarbellIcon,
  BedIcon,
  BicycleIcon,
  BuildingsIcon,
  BusIcon,
  CameraIcon,
  CarIcon,
  ChargingStationIcon,
  ChurchIcon,
  CoffeeIcon,
  EyeIcon,
  FirstAidIcon,
  FlagIcon,
  ForkKnifeIcon,
  GasPumpIcon,
  MapPinIcon,
  SoccerBallIcon,
  StorefrontIcon,
  StudentIcon,
  SwimmingPoolIcon,
  TrainSimpleIcon,
  TramIcon,
  TreeIcon,
  type Icon,
} from 'phosphor-react-native'
import type { MapPinKind } from '@/modules/map-points/constants/mapPoints'
import {
  getPlaceCategoryIconKey,
  type PlaceCategoryIconKey,
} from '@/modules/map-points/constants/placeCategoryIcon'

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

const PLACE_CATEGORY_ICONS: Record<PlaceCategoryIconKey, Icon> = {
  nature: TreeIcon,
  food: ForkKnifeIcon,
  coffee: CoffeeIcon,
  shopping: StorefrontIcon,
  lodging: BedIcon,
  health: FirstAidIcon,
  parking: CarIcon,
  school: StudentIcon,
  university: BuildingsIcon,
  bus: BusIcon,
  tram: TramIcon,
  rail: TrainSimpleIcon,
  airport: AirplaneIcon,
  fuel: GasPumpIcon,
  cycling: BicycleIcon,
  finance: BankIcon,
  worship: ChurchIcon,
  fitness: BarbellIcon,
  sports: SoccerBallIcon,
  swimming: SwimmingPoolIcon,
  scenic: CameraIcon,
  place: MapPinIcon,
}

/** Maps Mapbox's free-form place category onto the same Phosphor family as Vescape Map Points. */
export function getPlaceCategoryIcon(category: string | null) {
  return PLACE_CATEGORY_ICONS[getPlaceCategoryIconKey(category)]
}
