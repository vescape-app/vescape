import { useMemo } from 'react'
import { useFormat } from '@/hooks/useFormat'
import { useUnitSystem } from '@/hooks/useUnitSystem'
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

import { formatDistance, formatDuration, formatEnergy } from '@/modules/profile/lib/profileStats'
import { theme, type ThemeColor } from '@/constants/theme'

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
  accent: ThemeColor
}

/** Every riding total as a labelled, formatted, tinted figure — one definition for every surface
 *  that shows profile stats, so a number never carries two different labels. */
export function useProfileStatItems(
  stats: ProfileStats,
  keys?: ProfileStatKey[],
): ProfileStatItem[] {
  const units = useUnitSystem()
  const { formatSpeedWithUnit } = useFormat()
  const items = useMemo<ProfileStatItem[]>(
    () => [
      {
        key: 'distance',
        label: 'Distance',
        value: formatDistance(stats.distanceM, units),
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
        value: formatSpeedWithUnit(stats.topSpeedKmh),
        icon: GaugeIcon,
        accent: theme.status.warning.color,
      },
      {
        key: 'avgSpeed',
        label: 'Avg speed',
        value: formatSpeedWithUnit(stats.avgSpeedKmh),
        icon: RepeatIcon,
        accent: theme.palette.cyan.color,
      },
      {
        key: 'longestRide',
        label: 'Longest ride',
        value: formatDistance(stats.longestRideM, units),
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
    ],
    [stats, units, formatSpeedWithUnit],
  )
  return keys ? keys.flatMap((key) => items.filter((item) => item.key === key)) : items
}
