import { Pressable, StyleSheet, View } from 'react-native'
import {
  CloudIcon,
  CloudLightningIcon,
  CloudRainIcon,
  CloudSnowIcon,
  MoonStarsIcon,
  SunIcon,
  ThermometerColdIcon,
  ThermometerHotIcon,
  WindIcon,
  type Icon,
} from 'phosphor-react-native'
import type { RideWeatherCondition } from 'vescape-core'

import { Text } from '@/components/base/Text'
import { theme, type ThemeColor } from '@/constants/theme'
import { speedFromKmh, speedUnit, temperatureFromC, temperatureSymbol } from '@/helpers/units'
import { RIDE_WEATHER_THRESHOLDS } from '@/modules/history/lib/rideFilter'
import { useSettingsStore } from '@/modules/settings/store/settingsStore'

interface WeatherOption {
  condition: RideWeatherCondition
  label: string
  icon: Icon
  color: ThemeColor
}

/** Rows follow the native groups: pick within a row for "either", across rows for "both". */
const ROWS: readonly (readonly WeatherOption[])[] = [
  [
    { condition: 'clear', label: 'Clear', icon: SunIcon, color: theme.weather.sun },
    { condition: 'cloudy', label: 'Cloudy', icon: CloudIcon, color: theme.weather.cloud },
    { condition: 'rain', label: 'Rain', icon: CloudRainIcon, color: theme.weather.rain },
    { condition: 'snow', label: 'Snow', icon: CloudSnowIcon, color: theme.weather.snow },
    { condition: 'storm', label: 'Storm', icon: CloudLightningIcon, color: theme.weather.thunder },
  ],
  [
    { condition: 'cold', label: 'Cold', icon: ThermometerColdIcon, color: theme.weather.snow },
    { condition: 'hot', label: 'Hot', icon: ThermometerHotIcon, color: theme.palette.orange.color },
    { condition: 'windy', label: 'Windy', icon: WindIcon, color: theme.weather.cloud },
    { condition: 'night', label: 'Night', icon: MoonStarsIcon, color: theme.weather.moon },
  ],
]

interface WeatherFilterGridProps {
  value: readonly RideWeatherCondition[]
  onToggle: (condition: RideWeatherCondition) => void
}

/** Weather condition tiles for the History filter, each with its threshold in the rider's units. */
export function WeatherFilterGrid({ value, onToggle }: WeatherFilterGridProps) {
  const temperatureUnit = useSettingsStore((state) => state.temperatureUnit)
  const distanceUnit = useSettingsStore((state) => state.distanceUnit)
  const temperature = (celsius: number) =>
    `${Math.round(temperatureFromC(celsius, temperatureUnit))}${temperatureSymbol(temperatureUnit)}`
  const hints: Partial<Record<RideWeatherCondition, string>> = {
    rain: `${RIDE_WEATHER_THRESHOLDS.rainMinMinutes}+ min`,
    cold: `≤ ${temperature(RIDE_WEATHER_THRESHOLDS.coldMaxC)}`,
    hot: `≥ ${temperature(RIDE_WEATHER_THRESHOLDS.hotMinC)}`,
    windy: `${Math.round(speedFromKmh(RIDE_WEATHER_THRESHOLDS.windyMinGustKmh, distanceUnit))}+ ${speedUnit(distanceUnit)}`,
  }

  return (
    <View style={styles.rows}>
      {ROWS.map((row, index) => (
        <View key={index} style={styles.row}>
          {row.map((option) => {
            const selected = value.includes(option.condition)
            const IconComponent = option.icon
            return (
              <Pressable
                key={option.condition}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: selected }}
                accessibilityLabel={option.label}
                testID={`history-filter-weather-${option.condition}`}
                onPress={() => onToggle(option.condition)}
                style={[
                  styles.tile,
                  selected && {
                    backgroundColor: theme.alpha(option.color, 0.12),
                    borderColor: theme.alpha(option.color, 0.6),
                  },
                ]}
              >
                <IconComponent
                  size={22}
                  weight={selected ? 'fill' : 'duotone'}
                  color={selected ? option.color : theme.neutral.textSecondary}
                />
                <Text
                  numberOfLines={1}
                  style={[styles.label, selected && { color: theme.neutral.textPrimary }]}
                >
                  {option.label}
                </Text>
                <Text numberOfLines={1} style={styles.hint}>
                  {hints[option.condition] ?? ' '}
                </Text>
              </Pressable>
            )
          })}
        </View>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  rows: {
    gap: 8,
  },
  row: {
    flexDirection: 'row',
    gap: 6,
  },
  tile: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.neutral.border,
    backgroundColor: theme.control.background,
  },
  label: {
    color: theme.neutral.textSecondary,
    fontSize: 12,
    fontWeight: '700',
  },
  hint: {
    color: theme.neutral.textMuted,
    fontSize: 10,
    fontWeight: '600',
  },
})
