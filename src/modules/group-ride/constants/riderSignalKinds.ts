import {
  BatteryEmptyIcon,
  FirstAidIcon,
  HandIcon,
  LifebuoyIcon,
  WrenchIcon,
  type Icon,
} from 'phosphor-react-native'
import { RIDER_SIGNAL_KINDS, type RiderSignalKind } from 'vescape-core'

/**
 * Display label, icon, and urgency per kind, for the picker, roster badge, and map pin. Native
 * titles Ride Notices with the same labels and ranks the same kinds `critical`.
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/RiderSignal.kt `RiderSignalKind`
 * @parity /modules/vescape-core/ios/groupride/RiderSignal.swift `RiderSignalKind`
 */
export const RIDER_SIGNAL_KIND_INFO: Record<
  RiderSignalKind,
  { label: string; icon: Icon; critical: boolean }
> = {
  board: { label: 'Board problem', icon: WrenchIcon, critical: false },
  battery: { label: 'Out of battery', icon: BatteryEmptyIcon, critical: false },
  down: { label: 'Rider down', icon: FirstAidIcon, critical: true },
  wait: { label: 'Wait for me', icon: HandIcon, critical: false },
  help: { label: 'Need help', icon: LifebuoyIcon, critical: true },
}

/** The kind's info, or null for a wire kind this build does not know. */
export function riderSignalKindInfo(kind: string) {
  return (RIDER_SIGNAL_KINDS as readonly string[]).includes(kind)
    ? RIDER_SIGNAL_KIND_INFO[kind as RiderSignalKind]
    : null
}
