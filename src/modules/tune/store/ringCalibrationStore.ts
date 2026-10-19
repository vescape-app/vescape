import { create } from 'zustand'
import { DEFAULT_RING_ANCHORS, validateRingAnchors, type RingAnchors } from '../lib/ringCalibration'

function cloneAnchors(anchors: RingAnchors): RingAnchors {
  return Object.fromEntries(
    Object.entries(anchors).map(([id, values]) => [id, [...values]]),
  ) as RingAnchors
}

/** Temporary calibration session. Durable Tune Profiles remain native-owned. */
export const useRingCalibrationStore = create<{
  anchors: RingAnchors
  apply: (anchors: RingAnchors) => void
  reset: () => void
}>((set) => ({
  anchors: cloneAnchors(DEFAULT_RING_ANCHORS),
  apply: (anchors) => {
    const error = validateRingAnchors(anchors)
    if (error) throw new Error(error)
    set({ anchors: cloneAnchors(anchors) })
  },
  reset: () => set({ anchors: cloneAnchors(DEFAULT_RING_ANCHORS) }),
}))
