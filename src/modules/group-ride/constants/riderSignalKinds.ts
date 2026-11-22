import {
  AmbulanceIcon,
  BatteryEmptyIcon,
  CoffeeIcon,
  FirstAidIcon,
  HandIcon,
  LegoIcon,
  SirenIcon,
  SmileyXEyesIcon,
  TireIcon,
  ThermometerHotIcon,
  TrafficConeIcon,
  WavesIcon,
  WrenchIcon,
  type Icon,
} from 'phosphor-react-native'
import {
  RIDE_HAZARD_KINDS,
  RIDER_SIGNAL_KINDS,
  type RideHazardKind,
  type RiderSignalKind,
} from 'vescape-core'

export type PinHue =
  | 'red'
  | 'orange'
  | 'yellow'
  | 'green'
  | 'sky'
  | 'fuchsia'
  | 'cyan'
  | 'beige'
  | 'teal'
  | 'amber'
  | 'blue'

export interface PinKindInfo {
  label: string
  icon: Icon
  hue: PinHue
}

export interface RiderSignalKindInfo extends PinKindInfo {
  rank: number
  emphasis?: boolean
}

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/RiderSignal.kt `RiderSignalKind`
 * @parity /modules/vescape-core/ios/groupride/RiderSignal.swift `RiderSignalKind`
 */
export const RIDER_SIGNAL_KIND_INFO: Record<RiderSignalKind, RiderSignalKindInfo> = {
  serious: { label: 'Serious injury', icon: AmbulanceIcon, hue: 'red', rank: 2, emphasis: true },
  minor: { label: 'Minor injury', icon: FirstAidIcon, hue: 'orange', rank: 1, emphasis: true },
  down: { label: 'Rider down', icon: SmileyXEyesIcon, hue: 'yellow', rank: 0 },
  battery: { label: 'Battery dead', icon: BatteryEmptyIcon, hue: 'green', rank: 1 },
  tire: { label: 'Flat tire', icon: TireIcon, hue: 'sky', rank: 1 },
  overheat: { label: 'Overheating', icon: ThermometerHotIcon, hue: 'orange', rank: 1 },
  board: { label: 'Board fault', icon: WrenchIcon, hue: 'fuchsia', rank: 1 },
  wait: { label: 'Wait for me', icon: HandIcon, hue: 'cyan', rank: 0 },
  break: { label: 'Break', icon: CoffeeIcon, hue: 'beige', rank: 0 },
}

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/RiderSignal.kt `RideHazardKind`
 * @parity /modules/vescape-core/ios/groupride/RiderSignal.swift `RideHazardKind`
 */
export const RIDE_HAZARD_KIND_INFO: Record<RideHazardKind, PinKindInfo> = {
  water: { label: "Water's edge", icon: WavesIcon, hue: 'teal' },
  terrain: { label: 'Rough terrain', icon: LegoIcon, hue: 'amber' },
  obstacle: { label: 'Obstacle', icon: TrafficConeIcon, hue: 'yellow' },
  police: { label: 'Police', icon: SirenIcon, hue: 'blue' },
}

export function riderSignalKindInfo(kind: string): RiderSignalKindInfo | null {
  return (RIDER_SIGNAL_KINDS as readonly string[]).includes(kind)
    ? RIDER_SIGNAL_KIND_INFO[kind as RiderSignalKind]
    : null
}

export function rideHazardKindInfo(kind: string): PinKindInfo | null {
  return (RIDE_HAZARD_KINDS as readonly string[]).includes(kind)
    ? RIDE_HAZARD_KIND_INFO[kind as RideHazardKind]
    : null
}
