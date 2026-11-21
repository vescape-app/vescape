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
  setManualPublicRideSharing,
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
  ownLocation: { lat: number; lng: number } | null

  rosterRows: RosterRider[]
  relayClock: RelayClock | null
  signalAvailability: GroupRideSignalAvailability
  error: string | null
  focusRequest: { riderId: string; nonce: number } | null
  observing: boolean
  publicRide: PublicRideStatus
  publicRideAt: number
  publicRiders: PublicRider[]
  publicPins: PublicRiderPins[]
  publicOwnPins: OwnPins
  startObserving: () => void
  stopObserving: () => void
  setPublicRide: (choice: PublicRideChoice) => void
  setManualPublicRideSharing: (enabled: boolean) => void
  sendSignal: (kind: RiderSignalKind) => void
  clearSignal: () => void
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

const NO_SIGNAL_AVAILABILITY: GroupRideSignalAvailability = {
  supported: false,
  hazardsSupported: false,
  insidePrivacyZone: true,
  hasRecentFix: false,
}

const PUBLIC_RIDE_OFF: PublicRideStatus = {
  activation: 'off',
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
  observing: false,
  publicRide: PUBLIC_RIDE_OFF,
  publicRideAt: 0,
  publicRiders: [],
  publicPins: [],
  publicOwnPins: NO_OWN_PINS,

  startObserving() {
    if (get().observing) return
    subscriptions = [
      addGroupRideConnectionListener(({ state }) => {
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
      addPublicRideStatusListener((publicRide) => set({ publicRide, publicRideAt: Date.now() })),
      addPublicRidersListener(({ riders }) =>
        set((state) => deriveRoster({}, { ...state, publicRiders: riders })),
      ),
      addPublicPinsListener(({ pins, own, now }) =>
        set((state) => ({
          ...deriveRoster({}, { ...state, publicPins: pins }),
          publicPins: pins,
          publicOwnPins: own,
          relayClock: { relayNow: now, receivedAt: monotonicNow() },
        })),
      ),
      addLocationListener(({ latitude, longitude }) => {
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
      publicRideAt: 0,
      publicRiders: [],
      publicPins: [],
      publicOwnPins: NO_OWN_PINS,
    })
  },

  setPublicRide(choice) {
    setPublicRide(choice.mode !== 'off', publicRideUntil(choice, Date.now()))
  },

  setManualPublicRideSharing,

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
    rosterRows: rosterRowsEqual(rows, current.rosterRows) ? current.rosterRows : rows,
  }
}
