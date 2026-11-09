import {
  BatteryEmptyIcon,
  FirstAidIcon,
  HandIcon,
  LifebuoyIcon,
  WrenchIcon,
  type Icon,
} from 'phosphor-react-native'

/**
 * The fixed Rider Signal kinds, by their relay wire name, in picker order.
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/RiderSignal.kt `RiderSignalKind`
 * @parity /modules/vescape-core/ios/groupride/RiderSignal.swift `RiderSignalKind`
 */
export const RIDER_SIGNAL_KINDS = ['board', 'battery', 'down', 'wait', 'help'] as const

export type RiderSignalKind = (typeof RIDER_SIGNAL_KINDS)[number]

/**
 * Display label and icon per kind: the one source for picker, badge, and notice titles. Native
 * titles Ride Notices with the same labels.
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/RiderSignal.kt `RiderSignalKind`
 * @parity /modules/vescape-core/ios/groupride/RiderSignal.swift `RiderSignalKind`
 */
export const RIDER_SIGNAL_KIND_INFO: Record<RiderSignalKind, { label: string; icon: Icon }> = {
  board: { label: 'Board problem', icon: WrenchIcon },
  battery: { label: 'Out of battery', icon: BatteryEmptyIcon },
  down: { label: 'Rider down', icon: FirstAidIcon },
  wait: { label: 'Wait for me', icon: HandIcon },
  help: { label: 'Need help', icon: LifebuoyIcon },
}

/** The kind's info, or null for a wire kind this build does not know. */
export function riderSignalKindInfo(kind: string) {
  return (RIDER_SIGNAL_KINDS as readonly string[]).includes(kind)
    ? RIDER_SIGNAL_KIND_INFO[kind as RiderSignalKind]
    : null
}
