import { create } from 'zustand'
import { getGpsDisplaySettings, setGpsDisplaySettings, type GpsDisplaySettings } from 'vescape-core'

// Native settings cross a runtime boundary; the declared TS return type cannot guarantee fields.
// Keep initialization complete even when the bridge returns missing or partial settings.
// @parity /modules/vescape-core/ios/location/GpsDisplaySmoother.swift `init`
// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/location/GpsDisplaySmoother.kt
const defaults: GpsDisplaySettings = { smoothingPercent: 100, predictionPercent: 50 }
const settings = getGpsDisplaySettings()
const initial: GpsDisplaySettings = {
  smoothingPercent: Number.isFinite(settings?.smoothingPercent)
    ? settings.smoothingPercent
    : defaults.smoothingPercent,
  predictionPercent: Number.isFinite(settings?.predictionPercent)
    ? settings.predictionPercent
    : defaults.predictionPercent,
}

/** Session-only display controls. Native owns retargeting; measured GPS and camera stay untouched. */
export const useGpsDisplayStore = create<
  GpsDisplaySettings & {
    setSmoothingPercent: (percent: number) => void
    setPredictionPercent: (percent: number) => void
  }
>((set, get) => ({
  ...initial,
  setSmoothingPercent: (smoothingPercent) => {
    setGpsDisplaySettings({ smoothingPercent, predictionPercent: get().predictionPercent })
    set({ smoothingPercent })
  },
  setPredictionPercent: (predictionPercent) => {
    setGpsDisplaySettings({ predictionPercent, smoothingPercent: get().smoothingPercent })
    set({ predictionPercent })
  },
}))
