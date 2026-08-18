import { beforeEach, expect, mock, test } from 'bun:test'
import type { NearbyRide } from '@/modules/group-ride/lib/nearby'
import type { RosterRider } from '@/modules/group-ride/lib/roster'

type Listener<T> = (event: T) => void

const connectionListeners: Listener<{ state: string }>[] = []
const snapshotListeners: Listener<{ rides: unknown[] }>[] = []
const createdListeners: Listener<{ ride: unknown }>[] = []
const updatedListeners: Listener<{ ride: unknown }>[] = []
const endedListeners: Listener<{ rideId: string }>[] = []
const joinedListeners: Listener<{ rideId: string | null }>[] = []
const rosterListeners: Listener<{ rideId: string | null; riders: unknown[] }>[] = []
const errorListeners: Listener<{ message: string }>[] = []
const locationListeners: Listener<{ latitude: number; longitude: number }>[] = []

const createGroupRide = mock(() => {})
const joinGroupRide = mock(() => {})
const leaveGroupRide = mock(() => {})
const updateGroupRideIdentity = mock(() => {})
const startGroupRideObserve = mock(() => {})
const stopGroupRideObserve = mock(() => {})
const getSettings = mock(async () => ({ riderId: null, riderName: null }))
const updateSetting = mock(async () => {})

function subscribe<T>(listeners: Listener<T>[], listener: Listener<T>) {
  listeners.push(listener)
  return {
    remove() {
      const index = listeners.indexOf(listener)
      if (index !== -1) listeners.splice(index, 1)
    },
  }
}

mock.module('vescape-core', () => ({
  addGroupRideConnectionListener: (listener: Listener<{ state: string }>) =>
    subscribe(connectionListeners, listener),
  addGroupRideSnapshotListener: (listener: Listener<{ rides: unknown[] }>) =>
    subscribe(snapshotListeners, listener),
  addGroupRideCreatedListener: (listener: Listener<{ ride: unknown }>) =>
    subscribe(createdListeners, listener),
  addGroupRideUpdatedListener: (listener: Listener<{ ride: unknown }>) =>
    subscribe(updatedListeners, listener),
  addGroupRideEndedListener: (listener: Listener<{ rideId: string }>) =>
    subscribe(endedListeners, listener),
  addGroupRideJoinedListener: (listener: Listener<{ rideId: string | null }>) =>
    subscribe(joinedListeners, listener),
  addGroupRideRosterListener: (listener: Listener<{ rideId: string | null; riders: unknown[] }>) =>
    subscribe(rosterListeners, listener),
  addGroupRideErrorListener: (listener: Listener<{ message: string }>) =>
    subscribe(errorListeners, listener),
  addLocationListener: (listener: Listener<{ latitude: number; longitude: number }>) =>
    subscribe(locationListeners, listener),
  createGroupRide,
  joinGroupRide,
  leaveGroupRide,
  updateGroupRideIdentity,
  startGroupRideObserve,
  stopGroupRideObserve,
  getSettings,
  updateSetting,
}))

function ride(id: string) {
  return {
    id,
    name: `${id} ride`,
    createdAt: 1,
    riderCount: 1,
    location: { lat: 1, lng: 2 },
    creator: { id: 'creator', name: 'Creator' },
  }
}

function resetListeners() {
  connectionListeners.length = 0
  snapshotListeners.length = 0
  createdListeners.length = 0
  updatedListeners.length = 0
  endedListeners.length = 0
  joinedListeners.length = 0
  rosterListeners.length = 0
  errorListeners.length = 0
  locationListeners.length = 0
}

beforeEach(async () => {
  resetListeners()
  createGroupRide.mockClear()
  joinGroupRide.mockClear()
  leaveGroupRide.mockClear()
  updateGroupRideIdentity.mockClear()
  startGroupRideObserve.mockClear()
  stopGroupRideObserve.mockClear()
  const { useGroupRideStore } = await import('@/modules/group-ride/store/groupRideStore')
  useGroupRideStore.setState({
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
  })
})

test('snapshot clears active ride when server no longer has it', async () => {
  const { useGroupRideStore } = await import('@/modules/group-ride/store/groupRideStore')

  useGroupRideStore.getState().startObserving()
  useGroupRideStore.setState({
    activeRideId: 'old-ride',
    roster: [
      { id: 'rider', name: 'Rider', color: null, presence: null, stale: false, lastSeen: 1 },
    ],
    rosterRows: [],
    error: 'no such ride: old-ride',
  })

  snapshotListeners.forEach((listener) => listener({ rides: [ride('new-ride')] }))

  expect(useGroupRideStore.getState().activeRideId).toBeNull()
  expect(useGroupRideStore.getState().roster).toEqual([])
  expect(useGroupRideStore.getState().rosterRows).toEqual([])
})

test('online block clears stale ride state and marks the connection blocked', async () => {
  const { useGroupRideStore } = await import('@/modules/group-ride/store/groupRideStore')

  useGroupRideStore.getState().startObserving()
  useGroupRideStore.setState({
    connection: 'connected',
    rides: [ride('r1')],
    nearby: [{ ride: ride('r1'), distanceM: 10 }] as unknown as NearbyRide[],
    badge: true,
    activeRideId: 'r1',
    roster: [{ id: 'x', name: 'X', color: null, presence: null, stale: false, lastSeen: 1 }],
    rosterRows: [{ id: 'x' }] as unknown as RosterRider[],
    error: 'boom',
  })

  connectionListeners.forEach((listener) => listener({ state: 'blocked' }))

  const s = useGroupRideStore.getState()
  expect(s.connection).toBe('blocked')
  expect(s.rides).toEqual([])
  expect(s.nearby).toEqual([])
  expect(s.badge).toBe(false)
  expect(s.activeRideId).toBeNull()
  expect(s.roster).toEqual([])
  expect(s.rosterRows).toEqual([])
  expect(s.error).toBeNull()
})

test('successful join clears stale relay error', async () => {
  const { useGroupRideStore } = await import('@/modules/group-ride/store/groupRideStore')

  useGroupRideStore.getState().startObserving()
  useGroupRideStore.setState({ error: 'no such ride: old-ride' })

  joinedListeners.forEach((listener) => listener({ rideId: 'new-ride' }))

  expect(useGroupRideStore.getState().activeRideId).toBe('new-ride')
  expect(useGroupRideStore.getState().error).toBeNull()
})

test('joining another ride clears stale relay error immediately', async () => {
  const { useGroupRideStore } = await import('@/modules/group-ride/store/groupRideStore')
  const { useRiderStore } = await import('@/modules/group-ride/store/riderStore')

  useRiderStore.setState({ riderId: 'rider-1', riderName: 'Kupa', loaded: true })
  useGroupRideStore.setState({ error: 'no such ride: old-ride' })

  useGroupRideStore.getState().joinRide('new-ride')

  expect(joinGroupRide).toHaveBeenCalledWith({
    riderId: 'rider-1',
    riderName: 'Kupa',
    riderColor: null,
    rideId: 'new-ride',
  })
  expect(useGroupRideStore.getState().error).toBeNull()
})

test('name/color edits while observing push the new identity to peers', async () => {
  const { useGroupRideStore } = await import('@/modules/group-ride/store/groupRideStore')
  const { useRiderStore } = await import('@/modules/group-ride/store/riderStore')

  useRiderStore.setState({ riderId: 'rider-1', riderName: 'Old', riderColor: null, loaded: true })
  useGroupRideStore.getState().startObserving()

  await useRiderStore.getState().setName('  New Name  ')
  expect(updateGroupRideIdentity).toHaveBeenLastCalledWith({
    riderId: 'rider-1',
    riderName: 'New Name',
    riderColor: null,
  })

  await useRiderStore.getState().setColor('#38bdf8')
  expect(updateGroupRideIdentity).toHaveBeenLastCalledWith({
    riderId: 'rider-1',
    riderName: 'New Name',
    riderColor: '#38bdf8',
  })
})
