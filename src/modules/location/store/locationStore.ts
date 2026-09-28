import { create } from 'zustand'
import type { GpsPhase, LiveStateEvent, LocationEvent } from 'vescape-core'

import { appendLocation, createLocationHistory } from '@/modules/location/lib/locationHistory'

type GpsState = LiveStateEvent['gps']

interface LocationState {
  gpsStatus: GpsPhase
  latestApproximateLocation: LocationEvent | null
  liveLocationHistory: LocationEvent[]
}

interface LocationActions {
  applySnapshot: (gps: GpsState, windowMs: number) => void
  applyStatus: (gps: GpsState, windowMs: number) => void
  ingestLocation: (location: LocationEvent, windowMs: number) => void
  reset: () => void
  flushPending: () => void
  cancelPending: () => void
}

const PUBLISH_INTERVAL_MS = 1_000

/** JS presentation of native GPS state, independent of board connections. */
export function createLocationStore() {
  let history = createLocationHistory()
  let pending: ReturnType<typeof setTimeout> | null = null

  return create<LocationState & LocationActions>((set) => {
    function cancelPending() {
      if (pending !== null) clearTimeout(pending)
      pending = null
    }

    function publish(gpsStatus?: GpsPhase) {
      cancelPending()
      set({
        ...(gpsStatus === undefined ? {} : { gpsStatus }),
        liveLocationHistory: [...history.locations],
        latestApproximateLocation: history.latestApproximateLocation,
      })
    }

    function appendLatest(gps: GpsState, windowMs: number) {
      if (gps.latestFix) appendLocation(history, gps.latestFix, windowMs)
      if (gps.latestApproximateFix) appendLocation(history, gps.latestApproximateFix, windowMs)
    }

    return {
      gpsStatus: 'idle',
      liveLocationHistory: [],
      latestApproximateLocation: null,

      applySnapshot(gps, windowMs) {
        history = createLocationHistory()
        for (const location of gps.recentLocations) appendLocation(history, location, windowMs)
        appendLatest(gps, windowMs)
        publish(gps.phase)
      },

      applyStatus(gps, windowMs) {
        // Routine native status events omit history. They cannot replace the retained trail.
        appendLatest(gps, windowMs)
        publish(gps.phase)
      },

      ingestLocation(location, windowMs) {
        appendLocation(history, location, windowMs)
        if (pending === null) pending = setTimeout(() => publish(), PUBLISH_INTERVAL_MS)
      },

      reset() {
        history = createLocationHistory()
        publish('idle')
      },

      flushPending() {
        if (pending !== null) publish()
      },

      cancelPending,
    }
  })
}

export const useLocationStore = createLocationStore()
