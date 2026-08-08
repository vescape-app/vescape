import { useEffect } from 'react'

import { useWeatherStore } from '@/modules/weather/store/weatherStore'

interface WeatherData {
  temperature: number
  weatherCode: number
}

export function useMapWeather(
  location: { latitude: number; longitude: number } | null,
): WeatherData | null {
  const temperature = useWeatherStore((s) => s.temperature)
  const weatherCode = useWeatherStore((s) => s.weatherCode)
  const fetchWeather = useWeatherStore((s) => s.fetch)

  useEffect(() => {
    if (!location) return
    void fetchWeather(location.latitude, location.longitude)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- coords, not object identity, drive the refetch
  }, [location?.latitude, location?.longitude, fetchWeather])

  if (temperature == null || weatherCode == null) return null
  return { temperature, weatherCode }
}
