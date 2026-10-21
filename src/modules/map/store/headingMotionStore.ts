import { create } from 'zustand'

type HeadingSpeed = 'arrowSpeedPercent' | 'gpsCameraSpeedPercent' | 'compassCameraSpeedPercent'

/** Session-only presentation controls, relative to each spring's own default response. */
export const useHeadingMotionStore = create<
  Record<HeadingSpeed, number> & {
    setSpeed: (key: HeadingSpeed, percent: number) => void
  }
>((set) => ({
  arrowSpeedPercent: 100,
  gpsCameraSpeedPercent: 100,
  compassCameraSpeedPercent: 100,
  setSpeed: (key, percent) => {
    if (Number.isFinite(percent)) set({ [key]: Math.max(10, Math.min(400, percent)) })
  },
}))
