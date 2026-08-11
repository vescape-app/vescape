import { ScrollView, StyleSheet, View } from 'react-native'
import type { WeatherHour } from 'vescape-core'
import { Text } from '@/components/base/Text'

import { WeatherIcon } from '@/modules/weather/components/WeatherIcon'
import { theme } from '@/constants/theme'
import { formatHour, weatherIconColor } from '@/modules/weather/lib/weather'

function HourItem({ item }: { item: WeatherHour }) {
  return (
    <View style={styles.item}>
      <Text style={styles.hour}>{formatHour(item.minuteOfDay)}</Text>
      <WeatherIcon
        icon={item.icon}
        size={20}
        color={weatherIconColor(item.icon)}
        weight="duotone"
      />
      <Text style={styles.temp}>{item.temperatureC}°</Text>
      {item.precipitationProbability > 0 && (
        <Text style={styles.precip}>{item.precipitationProbability}%</Text>
      )}
    </View>
  )
}

/** Horizontal scroll of hourly forecast items. */
export function WeatherHourlyStrip({ hours }: { hours: WeatherHour[] }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.scroll}
      style={styles.container}
    >
      {hours.map((item) => (
        <HourItem key={item.minuteOfDay} item={item} />
      ))}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 0,
  },
  scroll: {
    paddingHorizontal: 16,
    gap: 4,
  },
  item: {
    alignItems: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
  },
  hour: {
    color: theme.palette.slate.textSecondary,
    fontSize: 11,
    fontWeight: '600',
  },
  temp: {
    color: theme.palette.slate.textPrimary,
    fontSize: 13,
    fontWeight: '600',
  },
  precip: {
    color: theme.palette.sky.color,
    fontSize: 10,
    fontWeight: '600',
  },
})
