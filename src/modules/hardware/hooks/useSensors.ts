import { useSyncExternalStore } from 'react'

import { sensorVersion, subscribeSensors } from '@/modules/hardware/lib/sensorRuntime'

/**
 * Ticks when the rows or the charts change — at native's ~4Hz series pace, not the link's, which
 * can be fifty frames a second. The values behind the rows never come through here at all: they
 * live in shared values the UI thread writes.
 */
export function useSensorVersion(): number {
  return useSyncExternalStore(subscribeSensors, sensorVersion, sensorVersion)
}
