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
  clearGroupRideHazard,
  clearGroupRideSignal,
  createGroupRide,
  getSettings,
  joinGroupRide,
  leaveGroupRide,
  sendGroupRideHazard,
  sendGroupRideSignal,
  startGroupRideObserve,
  stopGroupRideObserve,
  updateGroupRideIdentity,
  updateSetting,
  type GroupRideConnectionState,
  type GroupRideRider,
  type GroupRideSignalAvailability,
  type GroupRideSummary,
  type RideHazardKind,
  type RiderSignalKind,
} from 'vescape-core'

import { useBleStore } from '@/modules/board/store/bleStore'
import { nearbyRides, type NearbyRide } from '@/modules/group-ride/lib/nearby'
import { monotonicNow, type RelayClock } from '@/modules/group-ride/lib/riderSignal'
import { riderRoster, rosterRowsEqual, type RosterRider } from '@/modules/group-ride/lib/roster'
import { useRiderStore } from '@/modules/group-ride/store/riderStore'
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
  rosterRows: RosterRider[]
  /** Relay clock of the last roster that carried one; signal times are read against it. */
  relayClock: RelayClock | null
  /** Whether the joined Rider can send a Rider Signal now, as native judges it. */
  signalAvailability: GroupRideSignalAvailability
  error: string | null
  focusRequest: { riderId: string; nonce: number } | null
  observing: boolean
  /** Persisted header switch: ride publicly, re-auto-joining whenever not in a ride. */
  publicRiding: boolean
  /** Open the native observe WebSocket and mirror its lifecycle events into the store. */
  startObserving: () => void
  /** Close the observe WebSocket and clear observed state. */
  stopObserving: () => void
  /** Create a Group Ride from the device's own location; result arrives via `ride-created`. */
  createRide: (name: string) => void
  /** Turn public riding on (auto join nearest / create) or off (leave), and persist the choice. */
  setPublicRiding: (on: boolean) => void
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

/** Until native reports, assume nothing can be sent: an old relay must never see a `signal`. */
const NO_SIGNAL_AVAILABILITY: GroupRideSignalAvailability = {
  supported: false,
  hazardsSupported: false,
  insidePrivacyZone: true,
  hasRecentFix: false,
}

let subscriptions: { remove: () => void }[] = []
let rosterFreshnessTimer: TimerHandle | null = null
/** An auto `create` is in flight; cleared by `joined`, an error, or a connection change. */
let autoPending = false

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
  publicRiding: false,

  startObserving() {
    if (get().observing) return
    subscriptions = [
      addGroupRideConnectionListener(({ state }) => {
        autoPending = false
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
        autoPending = false
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
      addGroupRideErrorListener(({ message }) => {
        autoPending = false
        set({ error: message })
      }),
      // Own GPS only feeds the nearby list: the roster neither sorts nor stores distance, so a
      // fix leaves `rosterRows` (and every map layer reading it) untouched.
      addLocationListener(({ latitude, longitude }) =>
        set((state) => deriveNearby({ ownLocation: { lat: latitude, lng: longitude } }, state)),
      ),
      // Push name changes to peers without rejoining.
      {
        remove: useRiderStore.subscribe((rider, previous) => {
          if (rider.riderName === previous.riderName) return
          pushIdentity()
        }),
      },
    ]
    rosterFreshnessTimer = setInterval(() => {
      set((state) => deriveRoster({}, state))
    }, 1_000)
    // Re-join publicly whenever the switch is on, a board is connected and nothing holds a ride:
    // board connect, reconnect, or the ride ending. Every trigger lands here as a store change.
    subscriptions.push({ remove: useGroupRideStore.subscribe(ensurePublicRide) })
    subscriptions.push({ remove: useRiderStore.subscribe(ensurePublicRide) })
    subscriptions.push({ remove: useBleStore.subscribe(ensurePublicRide) })
    set({ observing: true })
    startGroupRideObserve(SERVER_WS_URL)
    // intentional-suppression: the switch stays off when settings can't load
    getSettings()
      .then((settings) => set({ publicRiding: settings.groupRidePublicEnabled }))
      .catch(() => undefined)
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
      relayClock: null,
      signalAvailability: NO_SIGNAL_AVAILABILITY,
      error: null,
      focusRequest: null,
    })
    autoPending = false
  },

  createRide(name) {
    startRide(get, set, name.trim() || null, false)
  },

  setPublicRiding(on) {
    if (!on) return get().leaveRide()
    set({ publicRiding: true })
    void updateSetting('groupRidePublicEnabled', true)
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
    // Leaving is an explicit opt-out, or public riding would re-join right away.
    if (get().publicRiding) {
      set({ publicRiding: false })
      void updateSetting('groupRidePublicEnabled', false)
    }
    leaveGroupRide()
    set({ activeRideId: null, roster: [], rosterRows: [], error: null })
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

/**
 * The device's Group Ride identity, with the same blank-name fallback the relay would
 * otherwise auto-apply. `riderId` is null until the rider identity has loaded.
 */
function currentIdentity(): { riderId: string | null; riderName: string } {
  const { riderId, riderName } = useRiderStore.getState()
  return { riderId, riderName: riderName?.trim() || 'Rider' }
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
): Pick<GroupRideState, 'activeRideId' | 'roster' | 'rosterRows'> {
  const activeRideId = patch.activeRideId === undefined ? current.activeRideId : patch.activeRideId
  const roster = patch.roster ?? current.roster
  const rows = riderRoster(roster, useRiderStore.getState().riderId)
  return {
    activeRideId,
    roster,
    // Keep the previous reference when nothing visible changed, so the 1s
    // freshness tick doesn't fan out to selectors as a new array.
    rosterRows: rosterRowsEqual(rows, current.rosterRows) ? current.rosterRows : rows,
  }
}

function ensurePublicRide() {
  const state = useGroupRideStore.getState()
  if (
    autoPending ||
    !state.publicRiding ||
    state.activeRideId ||
    state.connection !== 'connected' ||
    !state.ownLocation ||
    // Only while riding: opening the app or browsing old trails must not go public.
    useBleStore.getState().status !== 'connected' ||
    !useRiderStore.getState().riderId
  )
    return
  autoPending = true
  startRide(useGroupRideStore.getState, useGroupRideStore.setState, null, true)
}

/** Shared create path; `auto` lets the relay join the nearest ride instead of creating. */
function startRide(
  get: () => GroupRideState,
  set: (partial: (state: GroupRideState) => Partial<GroupRideState>) => void,
  name: string | null,
  auto: boolean,
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
    auto,
  })
}

function pushIdentity() {
  const { riderId, riderName } = currentIdentity()
  if (riderId) updateGroupRideIdentity({ riderId, riderName })
}
