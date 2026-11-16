import { create } from 'zustand'
import {
  addGroupRideConnectionListener,
  addGroupRideErrorListener,
  addGroupRideSignalAvailabilityListener,
  addLocationListener,
  addPublicPinsListener,
  addPublicRidersListener,
  addPublicRideStatusListener,
  clearGroupRideHazard,
  clearGroupRideSignal,
  sendGroupRideHazard,
  sendGroupRideSignal,
  setPublicRide,
  startGroupRideObserve,
  stopGroupRideObserve,
  stopWatchingPublicRiders,
  watchPublicRiders,
  type GroupRideConnectionState,
  type GroupRideSignalAvailability,
  type GroupRidePin,
  type PublicRider,
  type PublicRiderPins,
  type PublicRideStatus,
  type RideHazardKind,
  type RiderSignalKind,
} from 'vescape-core'

import { publicRideUntil, type PublicRideChoice } from '@/modules/group-ride/lib/publicRide'
import { monotonicNow, type RelayClock } from '@/modules/group-ride/lib/riderSignal'
import {
  publicRiderRoster,
  rosterRowsEqual,
  type RosterRider,
} from '@/modules/group-ride/lib/roster'
import { SERVER_WS_URL } from '@/config/server'

type TimerHandle = ReturnType<typeof setInterval>

interface GroupRideState {
  connection: GroupRideConnectionState
  /** Raw active-ride list from the relay (unfiltered). */
  /** Device's own location, mirrored from native GPS for local distance filtering. */
  ownLocation: { lat: number; lng: number } | null
  /** Active rides within range of {@link ownLocation}, nearest first. */
  /** Social-button badge state: true when at least one nearby ride exists. */

  /** Nearby public riders, nearest first and limited. */
  rosterRows: RosterRider[]
  /** Relay clock of the last roster that carried one; signal times are read against it. */
  relayClock: RelayClock | null
  /** Whether the joined Rider can send a Rider Signal now, as native judges it. */
  signalAvailability: GroupRideSignalAvailability
  error: string | null
  focusRequest: { riderId: string; nonce: number } | null
  /** Reopen Social when the profile it launched returns to Home. */
  restoreSocialAfterProfile: boolean
  observing: boolean
  /** The public ride switch and whether the rider is public now, as native reports it. */
  publicRide: PublicRideStatus
  /** Public riders native knows around this phone, nearest first. */
  publicRiders: PublicRider[]
  /** Other public riders' pins this phone may see, a far-away friend's signal included. */
  publicPins: PublicRiderPins[]
  /** The rider's own pins on the public ride, as sent. */
  publicOwnPins: OwnPins
  /** Open the native observe WebSocket and mirror its lifecycle events into the store. */
  startObserving: () => void
  /** Close the observe WebSocket and clear observed state. */
  stopObserving: () => void
  /** Move the public ride switch; native persists it and goes public when the board connects. */
  setPublicRide: (choice: PublicRideChoice) => void
  /** Raise a Rider Signal; replaces the current one. The roster brings it back once the relay has it. */
  sendSignal: (kind: RiderSignalKind) => void
  clearSignal: () => void
  /** Mark a Ride Hazard; replaces the current hazard, never the signal. */
  sendHazard: (kind: RideHazardKind) => void
  clearHazard: () => void
  focusRider: (riderId: string) => void
  clearError: () => void
}

interface OwnPins {
  signal: GroupRidePin | null
  hazard: GroupRidePin | null
}

const NO_OWN_PINS: OwnPins = { signal: null, hazard: null }

/** Until native reports, assume nothing can be sent: an old relay must never see a `signal`. */
const NO_SIGNAL_AVAILABILITY: GroupRideSignalAvailability = {
  supported: false,
  hazardsSupported: false,
  insidePrivacyZone: true,
  hasRecentFix: false,
}

/** Until native reports, the switch reads off and unsupported. */
const PUBLIC_RIDE_OFF: PublicRideStatus = {
  on: false,
  until: null,
  live: false,
  supported: false,
  reason: null,
}

let subscriptions: { remove: () => void }[] = []
let rosterFreshnessTimer: TimerHandle | null = null

export const useGroupRideStore = create<GroupRideState>((set, get) => ({
  connection: 'idle',

  ownLocation: null,

  rosterRows: [],
  relayClock: null,
  signalAvailability: NO_SIGNAL_AVAILABILITY,
  error: null,
  focusRequest: null,
  restoreSocialAfterProfile: false,
  observing: false,
  publicRide: PUBLIC_RIDE_OFF,
  publicRiders: [],
  publicPins: [],
  publicOwnPins: NO_OWN_PINS,

  startObserving() {
    if (get().observing) return
    subscriptions = [
      addGroupRideConnectionListener(({ state }) => {
        // Native gates the relay socket: on `blocked` (Online/App Block) it tore the connection
        // down, so clear the now-stale online ride/roster the Social surface would otherwise show.
        set(
          state === 'blocked'
            ? {
                connection: state,

                rosterRows: [],
                error: null,
              }
            : { connection: state },
        )
      }),
      addGroupRideSignalAvailabilityListener((signalAvailability) => set({ signalAvailability })),
      addGroupRideErrorListener(({ message }) => set({ error: message })),
      addPublicRideStatusListener((publicRide) => set({ publicRide })),
      addPublicRidersListener(({ riders }) =>
        set((state) => deriveRoster({}, { ...state, publicRiders: riders })),
      ),
      addPublicPinsListener(({ pins, own, now }) =>
        set((state) => ({
          ...deriveRoster({}, { ...state, publicPins: pins }),
          publicPins: pins,
          publicOwnPins: own,
          // Outside a ride the public pins are what the relay clock is read for.
          relayClock: { relayNow: now, receivedAt: monotonicNow() },
        })),
      ),
      // A ride roster neither sorts nor stores distance, so a fix leaves it untouched; the public
      // riders sort in distance bands, so rows only move when someone changes band.
      addLocationListener(({ latitude, longitude }) => {
        // The first fix re-centres look-around, which native started from the last known position.
        if (!get().ownLocation) watchPublicRiders()
        set((state) => {
          const next = {
            ...state,
            ownLocation: { lat: latitude, lng: longitude },
          }
          return { ...next, ...deriveRoster({}, next) }
        })
      }),
    ]
    rosterFreshnessTimer = setInterval(() => {
      set((state) => deriveRoster({}, state))
    }, 1_000)
    set({ observing: true })
    startGroupRideObserve(SERVER_WS_URL)
    // Look around even with the public ride switch off; native uses the last known position
    // until there is a fix.
    watchPublicRiders()
  },

  stopObserving() {
    if (!get().observing) return
    stopWatchingPublicRiders()
    stopGroupRideObserve()
    subscriptions.forEach((sub) => sub.remove())
    subscriptions = []
    if (rosterFreshnessTimer) {
      clearInterval(rosterFreshnessTimer)
      rosterFreshnessTimer = null
    }
    set({
      observing: false,
      connection: 'idle',

      ownLocation: null,

      rosterRows: [],
      relayClock: null,
      signalAvailability: NO_SIGNAL_AVAILABILITY,
      error: null,
      focusRequest: null,
      publicRide: PUBLIC_RIDE_OFF,
      publicRiders: [],
      publicPins: [],
      publicOwnPins: NO_OWN_PINS,
    })
  },

  setPublicRide(choice) {
    setPublicRide(choice.mode !== 'off', publicRideUntil(choice, Date.now()))
  },

  sendSignal(kind) {
    sendGroupRideSignal(kind)
  },

  clearSignal() {
    clearGroupRideSignal()
  },

  sendHazard(kind) {
    sendGroupRideHazard(kind)
  },

  clearHazard() {
    clearGroupRideHazard()
  },

  focusRider(riderId) {
    set((state) => ({ focusRequest: { riderId, nonce: (state.focusRequest?.nonce ?? 0) + 1 } }))
  },

  clearError() {
    set({ error: null })
  },
}))

/** The rider's own public signal or hazard. */
export function ownPin(state: GroupRideState, slot: keyof OwnPins): GroupRidePin | null {
  return state.publicOwnPins[slot]
}

function deriveRoster(
  _patch: Record<string, never>,
  current: GroupRideState,
): Pick<GroupRideState, 'rosterRows' | 'publicRiders'> {
  const rows = publicRiderRoster(current.publicRiders, current.ownLocation, current.publicPins)
  return {
    publicRiders: current.publicRiders,
    // Keep the previous reference when nothing visible changed, so the 1s
    // freshness tick doesn't fan out to selectors as a new array.
    rosterRows: rosterRowsEqual(rows, current.rosterRows) ? current.rosterRows : rows,
  }
}
