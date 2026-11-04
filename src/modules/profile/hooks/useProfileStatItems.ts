import { useMemo } from 'react'
import { useFormat } from '@/hooks/useFormat'
import { useDistanceUnit } from '@/hooks/useDistanceUnit'
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
  'distance' | 'rides' | 'rideTime' | 'topSpeed' | 'avgSpeed' | 'longestRide' | 'used' | 'regen'

/** A stat set by one ride, which tapping it opens. */
export type ProfileRecordKey = 'topSpeed' | 'longestRide'

export type OpenRecordRide = (rideId: string, record: ProfileRecordKey) => void

export interface ProfileStatItem {
  key: ProfileStatKey
  label: string
  value: string
  icon: Icon
  accent: ThemeColor
  /** Set when the figure links somewhere, e.g. the ride that set a record. */
  onPress?: () => void
}

/** Every riding total as a labelled, formatted, tinted figure — one definition for every surface
 *  that shows profile stats, so a number never carries two different labels. */
export function useProfileStatItems(
  stats: ProfileStats,
  keys?: ProfileStatKey[],
  /** Makes Top speed and Longest ride link to the ride that set them. */
  onOpenRecordRide?: OpenRecordRide,
): ProfileStatItem[] {
  const distanceUnit = useDistanceUnit()
  const { formatSpeedWithUnit } = useFormat()
  const items = useMemo<ProfileStatItem[]>(
    () => [
      {
        key: 'distance',
        label: 'Distance',
        value: formatDistance(stats.distanceM, distanceUnit),
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
        onPress: recordPress(stats.topSpeedRideId, 'topSpeed', onOpenRecordRide),
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
        value: formatDistance(stats.longestRideM, distanceUnit),
        icon: TrophyIcon,
        accent: theme.palette.yellow.color,
        onPress: recordPress(stats.longestRideId, 'longestRide', onOpenRecordRide),
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
    [stats, distanceUnit, formatSpeedWithUnit, onOpenRecordRide],
  )
  return keys ? keys.flatMap((key) => items.filter((item) => item.key === key)) : items
}

function recordPress(
  rideId: string | null,
  record: ProfileRecordKey,
  onOpenRecordRide: OpenRecordRide | undefined,
): (() => void) | undefined {
  return rideId && onOpenRecordRide ? () => onOpenRecordRide(rideId, record) : undefined
}
