import {
  AmbulanceIcon,
  BatteryEmptyIcon,
  DropHalfBottomIcon,
  FirstAidIcon,
  HandIcon,
  SmileyXEyesIcon,
  TireIcon,
  ThermometerHotIcon,
  TrafficConeIcon,
  TrendDownIcon,
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

/** The hue a pin kind's icon wears everywhere: picker, roster badge, map pin, Social takeover.
 *  Injuries climb yellow, orange, red with severity; the rest each get their own accent, so
 *  neighbouring tiles never share one (docs/design.md, Icons). */
export type PinHue =
  'red' | 'orange' | 'yellow' | 'green' | 'sky' | 'fuchsia' | 'cyan' | 'blue' | 'amber' | 'violet'

export interface PinKindInfo {
  label: string
  icon: Icon
  hue: PinHue
}

export interface RiderSignalKindInfo extends PinKindInfo {
  /** Orders kinds when several are active: a serious injury, a board problem, then a heads-up
   *  (a rider down after a small crash, a wait). */
  rank: number
  /** A faint wash of the hue on its picker tile: the injuries that need the group to act. */
  emphasis?: boolean
}

/**
 * Display label, icon, hue, and urgency per kind, for the picker, roster badge, and map pin. Native
 * titles Ride Notices with the same labels and ranks the kinds the same; the rank carries the
 * notice severity.
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
}

/**
 * Display label and icon per Ride Hazard kind, for the picker and map pin. Native names the same
 * kinds in its approach cues.
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/RiderSignal.kt `RideHazardKind`
 * @parity /modules/vescape-core/ios/groupride/RiderSignal.swift `RideHazardKind`
 */
export const RIDE_HAZARD_KIND_INFO: Record<RideHazardKind, PinKindInfo> = {
  water: { label: 'Water', icon: WavesIcon, hue: 'blue' },
  mud: { label: 'Mud', icon: DropHalfBottomIcon, hue: 'amber' },
  obstacle: { label: 'Obstacle', icon: TrafficConeIcon, hue: 'yellow' },
  descent: { label: 'Steep descent', icon: TrendDownIcon, hue: 'violet' },
}

/** The kind's info, or null for a wire kind this build does not know. */
export function riderSignalKindInfo(kind: string): RiderSignalKindInfo | null {
  return (RIDER_SIGNAL_KINDS as readonly string[]).includes(kind)
    ? RIDER_SIGNAL_KIND_INFO[kind as RiderSignalKind]
    : null
}

/** The hazard kind's info, or null for a wire kind this build does not know. */
export function rideHazardKindInfo(kind: string): PinKindInfo | null {
  return (RIDE_HAZARD_KINDS as readonly string[]).includes(kind)
    ? RIDE_HAZARD_KIND_INFO[kind as RideHazardKind]
    : null
}
