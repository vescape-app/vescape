import {
  BatteryChargingVerticalIcon,
  BatteryPlusVerticalIcon,
  ClockCountdownIcon,
  GaugeIcon,
  PathIcon,
  RepeatIcon,
  RoadHorizonIcon,
  TrophyIcon,
} from 'phosphor-react-native'
import type { Icon } from 'phosphor-react-native'
import type { ProfileStats } from 'vescape-core'

import {
  formatDistance,
  formatDuration,
  formatEnergy,
  formatSpeed,
} from '@/modules/profile/lib/profileStats'
import { theme } from '@/constants/theme'

export type ProfileStatKey =
  | 'distance'
  | 'rides'
  | 'rideTime'
  | 'topSpeed'
  | 'avgSpeed'
  | 'longestRide'
  | 'used'
  | 'regen'

export interface ProfileStatItem {
  key: ProfileStatKey
  label: string
  value: string
  icon: Icon
  accent: string
}

/** Every riding total as a labelled, formatted, tinted figure — one definition for every surface
 *  that shows profile stats, so a number never carries two different labels. */
export function profileStatItems(stats: ProfileStats): ProfileStatItem[] {
  return [
    {
      key: 'distance',
      label: 'Distance',
      value: formatDistance(stats.distanceM),
      icon: RoadHorizonIcon,
      accent: theme.palette.sky.color,
    },
    {
      key: 'rides',
      label: 'Rides',
      value: String(stats.rideCount),
      icon: PathIcon,
      accent: theme.palette.cyan.color,
    },
    {
      key: 'rideTime',
      label: 'Ride time',
      value: formatDuration(stats.rideTimeMs),
      icon: ClockCountdownIcon,
      accent: theme.palette.purple.color,
    },
    {
      key: 'topSpeed',
      label: 'Top speed',
      value: formatSpeed(stats.topSpeedKmh),
      icon: GaugeIcon,
      accent: theme.status.warning.color,
    },
    {
      key: 'avgSpeed',
      label: 'Avg speed',
      value: formatSpeed(stats.avgSpeedKmh),
      icon: RepeatIcon,
      accent: theme.palette.cyan.color,
    },
    {
      key: 'longestRide',
      label: 'Longest ride',
      value: formatDistance(stats.longestRideM),
      icon: TrophyIcon,
      accent: theme.palette.yellow.color,
    },
    {
      key: 'used',
      label: 'Battery used',
      value: formatEnergy(stats.batteryUsedWh),
      icon: BatteryChargingVerticalIcon,
      accent: theme.palette.sky.color,
    },
    {
      key: 'regen',
      label: 'Regen',
      value: formatEnergy(stats.batteryRegenWh),
      icon: BatteryPlusVerticalIcon,
      accent: theme.palette.green.text,
    },
  ]
}

/** The subset shown where there is no room for all eight. */
export function pickProfileStatItems(
  stats: ProfileStats,
  keys: ProfileStatKey[],
): ProfileStatItem[] {
  const items = profileStatItems(stats)
  return keys.flatMap((key) => items.filter((item) => item.key === key))
}
