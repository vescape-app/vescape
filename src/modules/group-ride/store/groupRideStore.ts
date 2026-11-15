import { create } from 'zustand'
import {
  addGroupRideConnectionListener,
  addGroupRideCreatedListener,
  addGroupRideEndedListener,
  addGroupRideErrorListener,
  addGroupRideJoinedListener,
  addGroupRideRosterListener,
  addGroupRideSignalAvailabilityListener,
  addGroupRideSnapshotListener,
  addGroupRideUpdatedListener,
  addLocationListener,
  addPublicPinsListener,
  addPublicRidersListener,
  addPublicRideStatusListener,
  clearGroupRideHazard,
  clearGroupRideSignal,
  createGroupRide,
  joinGroupRide,
  leaveGroupRide,
  sendGroupRideHazard,
  sendGroupRideSignal,
  setPublicRide,
  startGroupRideObserve,
  stopGroupRideObserve,
  stopWatchingPublicRiders,
  updateGroupRideIdentity,
  watchPublicRiders,
  type GroupRideConnectionState,
  type GroupRideRider,
  type GroupRideSignalAvailability,
  type GroupRideSummary,
  type GroupRidePin,
  type PublicRider,
  type PublicRiderPins,
  type PublicRideStatus,
  type RideHazardKind,
  type RiderSignalKind,
} from 'vescape-core'

import { nearbyRides, type NearbyRide } from '@/modules/group-ride/lib/nearby'
import { publicRideUntil, type PublicRideChoice } from '@/modules/group-ride/lib/publicRide'
import { monotonicNow, type RelayClock } from '@/modules/group-ride/lib/riderSignal'
import {
  publicRiderRoster,
  riderRoster,
  rosterRowsEqual,
  type RosterRider,
} from '@/modules/group-ride/lib/roster'
import { useRiderStore } from '@/modules/group-ride/store/riderStore'
// The Rider Profile nick, when set, is the name the rider rides under.
import { riderDisplayName, useRiderProfileStore } from '@/modules/profile/store/riderProfileStore'
import { SERVER_WS_URL } from '@/config/server'

type TimerHandle = ReturnType<typeof setInterval>

interface GroupRideState {
  connection: GroupRideConnectionState
  /** Raw active-ride list from the relay (unfiltered). */
  rides: GroupRideSummary[]
  /** Device's own location, mirrored from native GPS for local distance filtering. */
  ownLocation: { lat: number; lng: number } | null
  /** Active rides within range of {@link ownLocation}, nearest first. */
  nearby: NearbyRide[]
  /** Social-button badge state: true when at least one nearby ride exists. */
  badge: boolean
  activeRideId: string | null
  roster: GroupRideRider[]
  /** The joined ride's roster; outside a ride, the nearest public riders (nearest first, limited). */
  rosterRows: RosterRider[]
  /** Relay clock of the last roster that carried one; signal times are read against it. */
  relayClock: RelayClock | null
  /** Whether the joined Rider can send a Rider Signal now, as native judges it. */
  signalAvailability: GroupRideSignalAvailability
  error: string | null
  focusRequest: { riderId: string; nonce: number } | null
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
  /** Create a Group Ride from the device's own location; result arrives via `ride-created`. */
  createRide: (name: string) => void
  /** Move the public ride switch; native persists it and goes public when the board connects. */
  setPublicRide: (choice: PublicRideChoice) => void
  joinRide: (rideId: string) => void
  leaveRide: () => void
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
  rides: [],
  ownLocation: null,
  nearby: [],
  badge: false,
  activeRideId: null,
  roster: [],
  rosterRows: [],
  relayClock: null,
  signalAvailability: NO_SIGNAL_AVAILABILITY,
  error: null,
  focusRequest: null,
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
                rides: [],
                nearby: [],
                badge: false,
                activeRideId: null,
                roster: [],
                rosterRows: [],
                error: null,
              }
            : { connection: state },
        )
      }),
      addGroupRideSnapshotListener(({ rides }) =>
        set((state) => ({
          ...deriveNearby({ rides }, state),
          ...(!state.activeRideId || rides.some((ride) => ride.id === state.activeRideId)
            ? {}
            : { activeRideId: null, roster: [], rosterRows: [] }),
        })),
      ),
      addGroupRideCreatedListener(({ ride }) =>
        set((state) => ({
          ...deriveNearby({ rides: upsertRide(state.rides, ride) }, state),
          error: null,
        })),
      ),
      addGroupRideUpdatedListener(({ ride }) =>
        set((state) => ({
          ...deriveNearby({ rides: upsertRide(state.rides, ride) }, state),
          error: null,
        })),
      ),
      addGroupRideEndedListener(({ rideId }) =>
        set((state) => ({
          ...deriveNearby({ rides: state.rides.filter((ride) => ride.id !== rideId) }, state),
          ...(state.activeRideId === rideId
            ? { activeRideId: null, roster: [], rosterRows: [], error: null }
            : {}),
        })),
      ),
      addGroupRideJoinedListener(({ rideId }) => {
        set((state) => ({
          ...deriveRoster({ activeRideId: rideId, roster: [] }, state),
          error: null,
        }))
      }),
      addGroupRideRosterListener(({ rideId, riders, now }) =>
        set((state) => {
          const relayClock =
            typeof now === 'number'
              ? { relayNow: now, receivedAt: monotonicNow() }
              : state.relayClock
          if (!rideId) {
            return { ...deriveRoster({ activeRideId: null, roster: [] }, state), error: null }
          }
          // Membership comes from join intents/native join events. A queued presence roster
          // must not restore the ride after Leave has already cleared it.
          if (state.activeRideId !== rideId) return state
          return {
            ...deriveRoster({ activeRideId: rideId, roster: riders }, state),
            relayClock,
            error: null,
          }
        }),
      ),
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
          ...(state.activeRideId
            ? {}
            : { relayClock: { relayNow: now, receivedAt: monotonicNow() } }),
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
            ...deriveNearby({ ownLocation: { lat: latitude, lng: longitude } }, state),
          }
          return { ...next, ...deriveRoster({}, next) }
        })
      }),
      // Push name changes to peers without rejoining.
      {
        remove: useRiderStore.subscribe((rider, previous) => {
          if (rider.riderName === previous.riderName) return
          pushIdentity()
        }),
      },
      {
        remove: useRiderProfileStore.subscribe((profile, previous) => {
          if (profile.profile?.nick === previous.profile?.nick) return
          pushIdentity()
        }),
      },
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
      rides: [],
      ownLocation: null,
      nearby: [],
      badge: false,
      activeRideId: null,
      roster: [],
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

  createRide(name) {
    startRide(get, set, name.trim() || null)
  },

  setPublicRide(choice) {
    setPublicRide(choice.mode !== 'off', publicRideUntil(choice, Date.now()))
  },

  joinRide(rideId) {
    const { riderId, riderName } = currentIdentity()
    if (!riderId) return
    set((state) => ({
      ...deriveRoster({ activeRideId: rideId, roster: [] }, state),
      error: null,
    }))
    joinGroupRide({ riderId, riderName, rideId })
  },

  leaveRide() {
    leaveGroupRide()
    set((state) => ({ ...deriveRoster({ activeRideId: null, roster: [] }, state), error: null }))
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

/** The rider's own signal or hazard: its row in a joined ride, else as sent on the public ride. */
export function ownPin(state: GroupRideState, slot: keyof OwnPins): GroupRidePin | null {
  if (!state.activeRideId) return state.publicOwnPins[slot]
  return state.rosterRows.find((row) => row.isSelf)?.[slot] ?? null
}

/**
 * The device's Group Ride identity, with the same blank-name fallback the relay would
 * otherwise auto-apply. `riderId` is null until the rider identity has loaded.
 */
function currentIdentity(): { riderId: string | null; riderName: string } {
  const { riderId, riderName } = useRiderStore.getState()
  return { riderId, riderName: riderDisplayName(riderName)?.trim() || 'Rider' }
}

/** Merge a `rides`/`ownLocation` change with the current state and recompute the nearby view. */
function deriveNearby(
  patch: Partial<Pick<GroupRideState, 'rides' | 'ownLocation'>>,
  current: GroupRideState,
): Pick<GroupRideState, 'rides' | 'ownLocation' | 'nearby' | 'badge'> {
  const rides = patch.rides ?? current.rides
  const ownLocation = patch.ownLocation ?? current.ownLocation
  const { rides: nearby, badge } = nearbyRides(rides, ownLocation)
  return { rides, ownLocation, nearby, badge }
}

function upsertRide(rides: GroupRideSummary[], ride: GroupRideSummary): GroupRideSummary[] {
  const index = rides.findIndex((existing) => existing.id === ride.id)
  if (index === -1) return [...rides, ride]
  const next = rides.slice()
  next[index] = ride
  return next
}

function deriveRoster(
  patch: Partial<Pick<GroupRideState, 'activeRideId' | 'roster'>>,
  current: GroupRideState,
): Pick<GroupRideState, 'activeRideId' | 'roster' | 'rosterRows' | 'publicRiders'> {
  const activeRideId = patch.activeRideId === undefined ? current.activeRideId : patch.activeRideId
  const roster = patch.roster ?? current.roster
  // Outside a ride, the public riders around this phone take the roster's place.
  const rows = activeRideId
    ? riderRoster(roster, useRiderStore.getState().riderId)
    : publicRiderRoster(current.publicRiders, current.ownLocation, current.publicPins)
  return {
    activeRideId,
    roster,
    publicRiders: current.publicRiders,
    // Keep the previous reference when nothing visible changed, so the 1s
    // freshness tick doesn't fan out to selectors as a new array.
    rosterRows: rosterRowsEqual(rows, current.rosterRows) ? current.rosterRows : rows,
  }
}

function startRide(
  get: () => GroupRideState,
  set: (partial: (state: GroupRideState) => Partial<GroupRideState>) => void,
  name: string | null,
) {
  const { ownLocation } = get()
  if (!ownLocation) return
  const { riderId, riderName } = currentIdentity()
  if (!riderId) return
  set((state) => ({
    ...deriveRoster({ activeRideId: null, roster: [] }, state),
    error: null,
  }))
  createGroupRide({
    riderId,
    riderName,
    name,
    lat: ownLocation.lat,
    lng: ownLocation.lng,
    auto: false,
  })
}

function pushIdentity() {
  const { riderId, riderName } = currentIdentity()
  if (riderId) updateGroupRideIdentity({ riderId, riderName })
}
