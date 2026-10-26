import { StyleSheet, View } from 'react-native'
import type { RideWeather } from 'vescape-core'

import { Text } from '@/components/base/Text'
import { useUnitSystem } from '@/hooks/useUnitSystem'
import { formatRideTemperature } from '@/modules/history/lib/rideWeather'
import { WeatherIcon } from '@/modules/weather/components/WeatherIcon'
import { weatherIconColor } from '@/modules/weather/lib/weather'
import type { ThemeColor } from '@/constants/theme'

interface RideWeatherLabelProps {
  weather: RideWeather
  color: ThemeColor
  fontSize?: number
}

/** Dominant condition icon and temperature of a ride, inline with its other ride text. */
export function RideWeatherLabel({ weather, color, fontSize = 11 }: RideWeatherLabelProps) {
  const units = useUnitSystem()
  const temperature = formatRideTemperature(weather, units)
  return (
    <View
      style={styles.row}
      accessible
      accessibilityLabel={`Weather ${temperature}`}
      testID="ride-weather"
    >
      <WeatherIcon icon={weather.icon} size={fontSize + 2} color={weatherIconColor(weather.icon)} />
      <Text style={[styles.text, { color, fontSize, lineHeight: fontSize + 4 }]} numberOfLines={1}>
        {temperature}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    flexShrink: 0,
  },
  text: {
    fontVariant: ['tabular-nums'],
  },
})
