import { addWeatherListener, getWeather, type Weather } from 'vescape-core'
import { create } from 'zustand'

interface WeatherState {
  weather: Weather | null
}

interface WeatherActions {
  replace: (weather: Weather | null) => void
}

export const useWeatherStore = create<WeatherState & WeatherActions>((set) => ({
  weather: getWeather(),
  replace: (weather) => set({ weather }),
}))

export function startWeatherSync(): () => void {
  const sub = addWeatherListener((event) => useWeatherStore.getState().replace(event.weather))
  return () => sub.remove()
}
