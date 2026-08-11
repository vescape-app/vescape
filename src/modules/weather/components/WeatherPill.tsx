import { WeatherPill as WeatherPillView } from '@/modules/weather/components/WeatherPillView'
import { useWeatherStore } from '@/modules/weather/store/weatherStore'

interface WeatherPillProps {
  expanded?: boolean
  onPress: () => void
}

/** Store-bound container for the map weather pill. */
export function WeatherPill({ expanded, onPress }: WeatherPillProps) {
  const weather = useWeatherStore((s) => s.weather)

  if (!weather) return null

  return (
    <WeatherPillView
      icon={weather.icon}
      temperature={weather.temperatureC}
      label={weather.label}
      precipProbability={weather.precipitationProbability}
      sunriseMinuteOfDay={weather.sunriseMinuteOfDay}
      sunsetMinuteOfDay={weather.sunsetMinuteOfDay}
      expanded={expanded}
      onPress={onPress}
    />
  )
}
