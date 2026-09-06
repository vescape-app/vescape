import { addWeatherListener, getWeather, type Weather } from 'vescape-core'
import { create } from 'zustand'

interface WeatherState {
  weather: Weather | null
}

interface WeatherActions {
  replace: (weather: Weather | null) => void
}

/**
 * Mirror of the native forecast. Native fetches, caches and ages it off GPS Fixes; this store only
 * holds the last thing it was handed, so nothing here can decide to refetch — and the wrist and the
 * phone are guaranteed to be showing the same numbers.
 */
export const useWeatherStore = create<WeatherState & WeatherActions>((set) => ({
  weather: getWeather(),
  replace: (weather) => set({ weather }),
}))

/** Subscribe the store to native. Called once at app root; returns a teardown for the same reason. */
export function startWeatherSync(): () => void {
  const sub = addWeatherListener((event) => useWeatherStore.getState().replace(event.weather))
  return () => sub.remove()
}
