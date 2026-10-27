import { setWatchDisplayConfig } from 'vescape-core'
import { create } from 'zustand'
import {
  defaultMotionConfig,
  validMotionConfig,
  type MotionConfig,
} from '@/modules/map/lib/liveMotion/config'

/** Developer experiment, deliberately not persisted. One configuration per phone runtime. */
export const useLiveMotionSettings = create<{
  config: MotionConfig
  set: (key: keyof MotionConfig, value: number) => void
  reset: () => void
}>((set) => ({
  config: { ...defaultMotionConfig },
  set: (key, value) =>
    set((state) => ({ config: validMotionConfig({ ...state.config, [key]: value }) })),
  reset: () => set({ config: { ...defaultMotionConfig } }),
}))

useLiveMotionSettings.subscribe((state) => setWatchDisplayConfig(state.config))
