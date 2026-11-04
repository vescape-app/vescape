import { setMapDisplayConfig, type MotionConfig } from 'vescape-core'
import { create } from 'zustand'

/** Session-only intents; native returns the validated configuration and forwards it to watches. */
export const useLiveMotionSettings = create<{
  config: MotionConfig
  showSmoothedTrail: boolean
  showRawGpsPoint: boolean
  setOverlay: (key: 'showSmoothedTrail' | 'showRawGpsPoint', value: boolean) => void
  set: (key: keyof MotionConfig, value: number) => void
  reset: () => void
}>((set) => ({
  config: setMapDisplayConfig({}),
  showSmoothedTrail: false,
  showRawGpsPoint: false,
  setOverlay: (key, value) => set({ [key]: value }),
  set: (key, value) =>
    set((state) => ({
      config: setMapDisplayConfig({ ...state.config, [key]: value }),
    })),
  reset: () => set({ config: setMapDisplayConfig({}) }),
}))
