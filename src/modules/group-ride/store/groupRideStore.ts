import { create } from 'zustand'
import {
  addGroupRideConnectionListener,
  addGroupRideCreatedListener,
  addGroupRideEndedListener,
  addGroupRideErrorListener,
  addGroupRideJoinedListener,
  addGroupRideRosterListener,
  addGroupRideSnapshotListener,
  addGroupRideUpdatedListener,
  addLocationListener,
  createGroupRide,
  joinGroupRide,
  leaveGroupRide,
  startGroupRideObserve,
  stopGroupRideObserve,
  updateGroupRideIdentity,
  type GroupRideConnectionState,
  type GroupRideRider,
  type GroupRideSummary,
} from 'vescape-core'

import { nearbyRides, type NearbyRide } from '@/modules/group-ride/lib/nearby'
import { riderRoster, rosterRowsEqual, type RosterRider } from '@/modules/group-ride/lib/roster'
import { useRiderStore } from '@/modules/group-ride/store/riderStore'
import { SERVER_WS_URL } from '@/config/server'

type GroupRideSoundCue = 'created' | 'join'
let playGroupRideSound: ((cue: GroupRideSoundCue) => void) | null = null

export function setGroupRideSoundPlayer(player: ((cue: GroupRideSoundCue) => void) | null) {
  playGroupRideSound = player
}

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
  rosterRows: RosterRider[]
  error: string | null
  focusRequest: { riderId: string; nonce: number } | null
  observing: boolean
  /** Open the native observe WebSocket and mirror its lifecycle events into the store. */
  startObserving: () => void
  /** Close the observe WebSocket and clear observed state. */
  stopObserving: () => void
  /** Create a Group Ride from the device's own location; result arrives via `ride-created`. */
  createRide: (name: string) => void
  joinRide: (rideId: string) => void
  leaveRide: () => void
  focusRider: (riderId: string) => void
  clearError: () => void
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
  error: null,
  focusRequest: null,
  observing: false,

  startObserving() {
    if (get().observing) return
    subscriptions = [
      addGroupRideConnectionListener(({ state }) =>
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
        ),
      ),
      addGroupRideSnapshotListener(({ rides }) =>
        set((state) => ({
          ...deriveNearby({ rides }, state),
          ...(!state.activeRideId || rides.some((ride) => ride.id === state.activeRideId)
            ? {}
            : { activeRideId: null, roster: [], rosterRows: [] }),
        })),
      ),
      addGroupRideCreatedListener(({ ride }) => {
        const state = get()
        const next = deriveNearby({ rides: upsertRide(state.rides, ride) }, state)
        if (
          !state.rides.some((known) => known.id === ride.id) &&
          (ride.creator.id === useRiderStore.getState().riderId ||
            next.nearby.some((nearby) => nearby.ride.id === ride.id))
        ) {
          playGroupRideSound?.('created')
        }
        set({ ...next, error: null })
      }),
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
      addGroupRideJoinedListener(({ rideId }) =>
        set((state) => ({
          ...deriveRoster({ activeRideId: rideId, roster: [] }, state),
          error: null,
        })),
      ),
      addGroupRideRosterListener(({ rideId, riders }) =>
        set((state) => {
          if (!rideId) {
            return { ...deriveRoster({ activeRideId: null, roster: [] }, state), error: null }
          }
          if (state.activeRideId && state.activeRideId !== rideId) return state
          if (
            state.activeRideId === rideId &&
            state.roster.length > 0 &&
            riders.some(
              (rider) =>
                rider.id !== useRiderStore.getState().riderId &&
                !state.roster.some((known) => known.id === rider.id),
            )
          ) {
            playGroupRideSound?.('join')
          }
          return { ...deriveRoster({ activeRideId: rideId, roster: riders }, state), error: null }
        }),
      ),
      addGroupRideErrorListener(({ message }) => set({ error: message })),
      addLocationListener(({ latitude, longitude }) =>
        set((state) => ({
          ...deriveNearby({ ownLocation: { lat: latitude, lng: longitude } }, state),
          ...deriveRoster({ ownLocation: { lat: latitude, lng: longitude } }, state),
        })),
      ),
      // Push name/color edits to the live socket so peers see them without a rejoin.
      {
        remove: useRiderStore.subscribe((rider, previous) => {
          if (rider.riderName === previous.riderName && rider.riderColor === previous.riderColor)
            return
          const { riderId, riderName, riderColor } = currentIdentity()
          if (!riderId) return
          updateGroupRideIdentity({ riderId, riderName, riderColor })
        }),
      },
    ]
    rosterFreshnessTimer = setInterval(() => {
      set((state) => deriveRoster({}, state))
    }, 1_000)
    set({ observing: true })
    startGroupRideObserve(SERVER_WS_URL)
  },

  stopObserving() {
    if (!get().observing) return
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
      error: null,
      focusRequest: null,
    })
  },

  createRide(name) {
    const { ownLocation } = get()
    if (!ownLocation) return
    const { riderId, riderName, riderColor } = currentIdentity()
    if (!riderId) return
    set((state) => ({
      ...deriveRoster({ activeRideId: null, roster: [] }, state),
      error: null,
    }))
    createGroupRide({
      riderId,
      riderName,
      riderColor,
      name: name.trim() || null,
      lat: ownLocation.lat,
      lng: ownLocation.lng,
    })
  },

  joinRide(rideId) {
    const { riderId, riderName, riderColor } = currentIdentity()
    if (!riderId) return
    set((state) => ({
      ...deriveRoster({ activeRideId: rideId, roster: [] }, state),
      error: null,
    }))
    joinGroupRide({ riderId, riderName, riderColor, rideId })
  },

  leaveRide() {
    leaveGroupRide()
    set({ activeRideId: null, roster: [], rosterRows: [], error: null })
  },

  focusRider(riderId) {
    set((state) => ({ focusRequest: { riderId, nonce: (state.focusRequest?.nonce ?? 0) + 1 } }))
  },

  clearError() {
    set({ error: null })
  },
}))

/**
 * The device's Group Ride identity, with the same blank-name fallback the relay would
 * otherwise auto-apply. `riderId` is null until the rider identity has loaded.
 */
function currentIdentity(): {
  riderId: string | null
  riderName: string
  riderColor: string | null
} {
  const { riderId, riderName, riderColor } = useRiderStore.getState()
  return { riderId, riderName: riderName?.trim() || 'Rider', riderColor }
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
  patch: Partial<Pick<GroupRideState, 'activeRideId' | 'roster' | 'ownLocation'>>,
  current: GroupRideState,
): Pick<GroupRideState, 'activeRideId' | 'roster' | 'rosterRows'> {
  const activeRideId = patch.activeRideId ?? current.activeRideId
  const roster = patch.roster ?? current.roster
  const ownLocation = patch.ownLocation ?? current.ownLocation
  const rows = riderRoster(roster, useRiderStore.getState().riderId, ownLocation)
  return {
    activeRideId,
    roster,
    // Keep the previous reference when nothing visible changed, so the 1s
    // freshness tick and GPS ticks don't fan out to selectors as new arrays.
    rosterRows: rosterRowsEqual(rows, current.rosterRows) ? current.rosterRows : rows,
  }
}
