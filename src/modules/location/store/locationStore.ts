import { create } from 'zustand'
import type { GpsDisplayMotion, GpsPhase, LiveStateEvent, LocationEvent } from 'vescape-core'

import { appendLocation, createLocationHistory } from '@/modules/location/lib/locationHistory'

type GpsState = LiveStateEvent['gps']

interface LocationState {
  latestRawLocation: LocationEvent | null
  latestPreciseLocation: LocationEvent | null
  displayMotion: GpsDisplayMotion | null
  gpsStatus: GpsPhase
  latestApproximateLocation: LocationEvent | null
  liveLocationHistory: LocationEvent[]
}

interface LocationActions {
  ingestDisplayMotion: (motion: GpsDisplayMotion | null) => void
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

    function publishRaw(location: LocationEvent) {
      set((state) => {
        const rawChanged =
          !state.latestRawLocation || state.latestRawLocation.timestamp < location.timestamp
        const preciseChanged =
          location.precise &&
          (!state.latestPreciseLocation ||
            state.latestPreciseLocation.timestamp < location.timestamp)
        if (!rawChanged && !preciseChanged) return state
        return {
          ...(rawChanged ? { latestRawLocation: location } : {}),
          ...(preciseChanged ? { latestPreciseLocation: location } : {}),
        }
      })
    }

    function ingestDisplayMotion(displayMotion: GpsDisplayMotion | null) {
      set((state) => {
        // GPS, state and telemetry arrive on separate channels. Only snapshots may rewind clocks.
        if (
          displayMotion &&
          state.displayMotion &&
          displayMotion.startsAtMs < state.displayMotion.startsAtMs
        )
          return state
        return { displayMotion }
      })
    }

    function appendLatest(gps: GpsState, windowMs: number) {
      if (gps.latestFix) {
        appendLocation(history, gps.latestFix, windowMs)
        publishRaw(gps.latestFix)
      }
      if (gps.latestApproximateFix) {
        appendLocation(history, gps.latestApproximateFix, windowMs)
        publishRaw(gps.latestApproximateFix)
      }
    }

    return {
      ingestDisplayMotion,
      latestRawLocation: null,
      latestPreciseLocation: null,
      displayMotion: null,
      gpsStatus: 'idle',
      liveLocationHistory: [],
      latestApproximateLocation: null,

      applySnapshot(gps, windowMs) {
        set({
          displayMotion: gps.displayMotion ?? null,
          latestRawLocation: null,
          latestPreciseLocation: null,
        })
        history = createLocationHistory()
        for (const location of gps.recentLocations) appendLocation(history, location, windowMs)
        const latestRetained = history.locations.at(-1)
        if (latestRetained) publishRaw(latestRetained)
        appendLatest(gps, windowMs)
        publish(gps.phase)
      },

      applyStatus(gps, windowMs) {
        if (gps.displayMotion !== undefined) ingestDisplayMotion(gps.displayMotion)
        // Routine native status events omit history. They cannot replace the retained trail.
        appendLatest(gps, windowMs)
        publish(gps.phase)
      },

      ingestLocation(location, windowMs) {
        publishRaw(location)
        // Motion has its own native timestamps: do not delay it behind the 1Hz trail batching.
        if (location.displayMotion !== undefined) ingestDisplayMotion(location.displayMotion)
        appendLocation(history, location, windowMs)
        if (pending === null) pending = setTimeout(() => publish(), PUBLISH_INTERVAL_MS)
      },

      reset() {
        set({ displayMotion: null, latestRawLocation: null, latestPreciseLocation: null })
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
