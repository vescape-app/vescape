import { beforeEach, expect, mock, test } from 'bun:test'
import type { PublicRideStatus } from 'vescape-core'

type Listener<T> = (event: T) => void

const connectionListeners: Listener<{ state: string }>[] = []
const signalAvailabilityListeners: Listener<unknown>[] = []
const errorListeners: Listener<{ message: string }>[] = []
const locationListeners: Listener<{ latitude: number; longitude: number }>[] = []
const publicRideStatusListeners: Listener<unknown>[] = []
const publicRidersListeners: Listener<{ riders: unknown[]; now: number | null }>[] = []
const publicPinsListeners: Listener<unknown>[] = []
const setManualPublicRideSharing = mock((_enabled: boolean) => {})
const setPublicRide = mock((_on: boolean, _until: number | null) => {})

const startGroupRideObserve = mock(() => {})
const stopGroupRideObserve = mock(() => {})
const watchPublicRiders = mock(() => {})
const stopWatchingPublicRiders = mock(() => {})
function subscribe<T>(listeners: Listener<T>[], listener: Listener<T>) {
  listeners.push(listener)
  return {
    remove() {
      const index = listeners.indexOf(listener)
      if (index !== -1) listeners.splice(index, 1)
    },
  }
}

// Load the real board store against the real native surface before narrowing `vescape-core`;
// public riding only reads its `status`, which stays idle here.
await import('@/modules/board/store/bleStore')

mock.module('vescape-core', () => ({
  addGroupRideConnectionListener: (listener: Listener<{ state: string }>) =>
    subscribe(connectionListeners, listener),
  addGroupRideSignalAvailabilityListener: (listener: Listener<unknown>) =>
    subscribe(signalAvailabilityListeners, listener),
  sendGroupRideSignal: () => {},
  clearGroupRideSignal: () => {},
  sendGroupRideHazard: () => {},
  clearGroupRideHazard: () => {},
  addGroupRideErrorListener: (listener: Listener<{ message: string }>) =>
    subscribe(errorListeners, listener),
  addLocationListener: (listener: Listener<{ latitude: number; longitude: number }>) =>
    subscribe(locationListeners, listener),
  addPublicRideStatusListener: (listener: Listener<unknown>) =>
    subscribe(publicRideStatusListeners, listener),
  addPublicRidersListener: (listener: Listener<{ riders: unknown[]; now: number | null }>) =>
    subscribe(publicRidersListeners, listener),
  addPublicPinsListener: (listener: Listener<unknown>) => subscribe(publicPinsListeners, listener),
  setPublicRide,
  setManualPublicRideSharing,
  startGroupRideObserve,
  stopGroupRideObserve,
  watchPublicRiders,
  stopWatchingPublicRiders,
  getCompanionPresenceBoards: async () => [],
  addCompanionPresenceBoard: async () => undefined,
  removeCompanionPresenceBoard: async () => undefined,
  setCompanionPresenceEnabled: async () => undefined,
}))

function resetListeners() {
  connectionListeners.length = 0
  signalAvailabilityListeners.length = 0
  errorListeners.length = 0
  locationListeners.length = 0
  publicRideStatusListeners.length = 0
  publicRidersListeners.length = 0
  publicPinsListeners.length = 0
}

beforeEach(async () => {
  resetListeners()
  startGroupRideObserve.mockClear()
  stopGroupRideObserve.mockClear()
  watchPublicRiders.mockClear()
  stopWatchingPublicRiders.mockClear()
  setPublicRide.mockClear()
  setManualPublicRideSharing.mockClear()
  const { useGroupRideStore } = await import('@/modules/group-ride/store/groupRideStore')
  useGroupRideStore.setState({
    connection: 'idle',
    ownLocation: null,
    rosterRows: [],
    relayClock: null,
    error: null,
    focusRequest: null,
    observing: false,
  })
})

test('the public ride switch mirrors native and sends the end time for hours', async () => {
  const { useGroupRideStore } = await import('@/modules/group-ride/store/groupRideStore')
  useGroupRideStore.getState().startObserving()

  const before = Date.now()
  useGroupRideStore.getState().setPublicRide({ mode: 'hours', hours: 2 })
  const [on, until] = setPublicRide.mock.calls[0]
  expect(on).toBe(true)
  expect(until).toBeGreaterThanOrEqual(before + 2 * 3_600_000)

  useGroupRideStore.getState().setPublicRide({ mode: 'always' })
  expect(setPublicRide.mock.calls[1]).toEqual([true, null])

  const status: PublicRideStatus = {
    activation: 'board',
    until: null,
    live: true,
    supported: true,
    reason: null,
  }
  publicRideStatusListeners.forEach((listener) => listener(status))
  expect(useGroupRideStore.getState().publicRide).toEqual(status)
})

test('manual sharing sends a separate native intent and waits for native status', async () => {
  const { useGroupRideStore } = await import('@/modules/group-ride/store/groupRideStore')
  useGroupRideStore.getState().startObserving()

  const status: PublicRideStatus = {
    activation: 'waiting',
    until: Date.now() + 3_600_000,
    live: false,
    supported: true,
    reason: null,
  }
  publicRideStatusListeners.forEach((listener) => listener(status))
  useGroupRideStore.getState().setManualPublicRideSharing(true)
  expect(useGroupRideStore.getState().publicRide).toEqual(status)

  const started: PublicRideStatus = { ...status, activation: 'phone' }
  publicRideStatusListeners.forEach((listener) => listener(started))
  expect(useGroupRideStore.getState().publicRide).toEqual(started)
  useGroupRideStore.getState().setManualPublicRideSharing(false)
  expect(useGroupRideStore.getState().publicRide).toEqual(started)

  const handedOff: PublicRideStatus = { ...started, activation: 'board' }
  publicRideStatusListeners.forEach((listener) => listener(handedOff))
  expect(useGroupRideStore.getState().publicRide).toEqual(handedOff)

  expect(setManualPublicRideSharing.mock.calls).toEqual([[true], [false]])
  expect(setPublicRide).not.toHaveBeenCalled()
  useGroupRideStore.getState().stopObserving()
})

test('looks around with the switch off and shows public riders outside a ride', async () => {
  const { useGroupRideStore } = await import('@/modules/group-ride/store/groupRideStore')
  useGroupRideStore.getState().startObserving()
  expect(watchPublicRiders).toHaveBeenCalledTimes(1)

  const near = {
    accountId: 'a1',
    nick: 'Ana',
    presence: { lat: 1, lng: 2 },
    stale: false,
    away: false,
    lastSeen: 0,
  }
  publicRidersListeners.forEach((listener) => listener({ riders: [near], now: null }))
  expect(useGroupRideStore.getState().rosterRows.map((row) => row.id)).toEqual(['a1'])

  // Native moves look-around with the rider's fixes; JS asks only once.
  locationListeners.forEach((listener) => listener({ latitude: 1, longitude: 2 }))
  expect(watchPublicRiders).toHaveBeenCalledTimes(1)

  useGroupRideStore.getState().stopObserving()
  expect(stopWatchingPublicRiders).toHaveBeenCalledTimes(1)
})

test('public pins pin other riders, a far-away friend included, and keep the own pins apart', async () => {
  const { ownPin, useGroupRideStore } = await import('@/modules/group-ride/store/groupRideStore')
  useGroupRideStore.getState().startObserving()
  const signal = { kind: 'serious', lat: 1, lng: 2, startedAt: 5, expiresAt: 9 }
  const own = { kind: 'wait', lat: 1, lng: 2, startedAt: 6, expiresAt: 10 }
  publicPinsListeners.forEach((listener) =>
    listener({
      pins: [{ accountId: 'friend', nick: 'Ola', signal, hazard: null }],
      own: { signal: own, hazard: null },
      now: 7,
    }),
  )
  const state = useGroupRideStore.getState()
  expect(state.rosterRows).toMatchObject([{ id: 'friend', name: 'Ola', signal, isSelf: false }])
  expect(state.relayClock?.relayNow).toBe(7)
  expect(ownPin(state, 'signal')).toBe(own)
  useGroupRideStore.getState().stopObserving()
})
