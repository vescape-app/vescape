import { WeatherHourlyStrip as WeatherHourlyStripView } from '@/modules/weather/components/WeatherHourlyStripView'
import { useWeatherStore } from '@/modules/weather/store/weatherStore'

export function WeatherHourlyStrip() {
  const hourly = useWeatherStore((s) => s.weather?.hourly)

  if (!hourly || hourly.length === 0) return null

  return <WeatherHourlyStripView hours={hourly} />
}
