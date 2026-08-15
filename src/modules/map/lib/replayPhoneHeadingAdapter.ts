import { addReplayPhoneHeadingListener } from 'vescape-core'

import type { PhoneHeadingAdapter } from '@/modules/map/lib/phoneHeading'

/**
 * The compass source for a replay: readings recorded during the original ride, played back by native
 * on the recording's own timeline.
 *
 * A replay runs on whatever phone is holding it — usually flat on a desk — so the real magnetometer
 * has nothing useful to say about the ride being replayed. This stands in at the sensor boundary,
 * re-encoding each recorded bearing as the `rotation.alpha` a DeviceMotion event would have carried,
 * so every consumer downstream (Compass follow rotation, the heading cone, navigation diagnostics)
 * runs its real code path and cannot tell the difference.
 *
 * Nothing here invents motion. The smoothing and dead-banding in `phoneHeading.ts` are the same ones
 * a live compass goes through, and they are fed the same kind of raw stream.
 *
 * A recording made before `phone-heading` lines existed simply produces no events — the layer keeps
 * its last heading, exactly as it would with a sensor that has stopped reporting.
 */
export function createReplayPhoneHeadingAdapter(): PhoneHeadingAdapter {
  return {
    isAvailableAsync: async () => true,
    getPermissionsAsync: async () => ({ status: 'granted' }),
    requestPermissionsAsync: async () => ({ status: 'granted' }),
    // Native replays each reading at its recorded offset, so the cadence is the recording's, not
    // ours. Nothing to set.
    setUpdateInterval: () => {},
    addListener: (listener) => {
      const subscription = addReplayPhoneHeadingListener(({ headingDeg }) => {
        listener({
          rotation: {
            // Inverse of `phoneHeadingFromDeviceMotion` at orientation 0.
            alpha: (-headingDeg * Math.PI) / 180,
            beta: 0,
            gamma: 0,
            timestamp: Date.now(),
          },
          orientation: 0,
        })
      })
      return { remove: () => subscription.remove() }
    },
  }
}
