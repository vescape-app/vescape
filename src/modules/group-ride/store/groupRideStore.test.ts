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
const getSettings = mock(
  async (): Promise<{
    riderId: string | null
    riderName: string | null
    riderColor?: string | null
  }> => ({ riderId: null, riderName: null }),
)
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

// Load the real board store against the real native surface before narrowing `vescape-core`;
// public riding only reads its `status`, which stays idle here.
await import('@/modules/board/store/bleStore')

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
  getCompanionPresenceBoards: async () => [],
  addCompanionPresenceBoard: async () => undefined,
  removeCompanionPresenceBoard: async () => undefined,
  setCompanionPresenceEnabled: async () => undefined,
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
  getSettings.mockReset()
  getSettings.mockImplementation(async () => ({ riderId: null, riderName: null }))
  updateSetting.mockReset()
  updateSetting.mockImplementation(async () => {})
  const { useGroupRideStore } = await import('@/modules/group-ride/store/groupRideStore')
  const { useRiderStore } = await import('@/modules/group-ride/store/riderStore')
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
  useRiderStore.setState({
    riderId: null,
    riderName: null,
    loaded: false,
    error: null,
  })
})

test('identity load is single-flight and queued edits cannot be overwritten by stale settings', async () => {
  const { useRiderStore } = await import('@/modules/group-ride/store/riderStore')
  let resolveSettings!: (value: { riderId: string; riderName: string }) => void
  getSettings.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveSettings = resolve
      }),
  )

  const firstLoad = useRiderStore.getState().load()
  const secondLoad = useRiderStore.getState().load()
  const edit = useRiderStore.getState().setName('New name')
  await Promise.resolve()

  expect(firstLoad).toBe(secondLoad)
  expect(getSettings).toHaveBeenCalledTimes(1)
  expect(updateSetting).not.toHaveBeenCalled()

  resolveSettings({ riderId: 'rider-1', riderName: 'Old name' })
  await Promise.all([firstLoad, secondLoad, edit])

  expect(updateSetting).toHaveBeenCalledTimes(1)
  expect(updateSetting).toHaveBeenCalledWith('riderName', 'New name')
  expect(useRiderStore.getState()).toMatchObject({
    riderId: 'rider-1',
    riderName: 'New name',
    loaded: true,
    error: null,
  })
})

test('legacy Social color is cleared without changing Rider identity', async () => {
  const { useRiderStore } = await import('@/modules/group-ride/store/riderStore')
  getSettings.mockImplementationOnce(async () => ({
    riderId: 'rider-1',
    riderName: 'Rider name',
    riderColor: '#38bdf8',
  }))

  await useRiderStore.getState().load()

  expect(updateSetting).toHaveBeenCalledTimes(1)
  expect(updateSetting).toHaveBeenCalledWith('riderColor', null)
  expect(useRiderStore.getState()).toMatchObject({
    riderId: 'rider-1',
    riderName: 'Rider name',
    loaded: true,
  })
})

test('rapid rider name edits persist and apply in request order', async () => {
  const { useRiderStore } = await import('@/modules/group-ride/store/riderStore')
  let finishNameWrite!: () => void
  updateSetting.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finishNameWrite = resolve
      }),
  )

  const nameWrite = useRiderStore.getState().setName('First')
  const secondNameWrite = useRiderStore.getState().setName('Second')
  await Promise.resolve()

  expect(updateSetting).toHaveBeenCalledTimes(1)
  expect(updateSetting).toHaveBeenCalledWith('riderName', 'First')
  finishNameWrite()
  await Promise.all([nameWrite, secondNameWrite])

  expect(updateSetting).toHaveBeenNthCalledWith(2, 'riderName', 'Second')
  expect(useRiderStore.getState()).toMatchObject({
    riderName: 'Second',
    error: null,
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

test('name/board color edits while observing push the new identity to peers', async () => {
  const { useGroupRideStore } = await import('@/modules/group-ride/store/groupRideStore')
  const { useRiderStore } = await import('@/modules/group-ride/store/riderStore')

  useRiderStore.setState({ riderId: 'rider-1', riderName: 'Old', loaded: true })
  useGroupRideStore.getState().startObserving()

  await useRiderStore.getState().setName('  New Name  ')
  expect(updateGroupRideIdentity).toHaveBeenLastCalledWith({
    riderId: 'rider-1',
    riderName: 'New Name',
    riderColor: null,
  })

  const { useBoardStore } = await import('@/modules/board/store/boardStore')
  useBoardStore.setState({
    activeBoardId: 'board-1',
    boards: [{ id: 'board-1', personalization: { railId: 'x7', railColorId: 'cyan' } } as never],
  })
  expect(updateGroupRideIdentity).toHaveBeenLastCalledWith({
    riderId: 'rider-1',
    riderName: 'New Name',
    riderColor: expect.any(String),
  })
})

test('selected Board rail color follows Board and appearance; no Board clears it', async () => {
  const { useBoardStore } = await import('@/modules/board/store/boardStore')
  const { useThemeStore } = await import('@/hooks/useTheme')
  const { selectedBoardRailColor } = await import('@/modules/group-ride/lib/selectedBoardRailColor')
  const { accentColors, personalizationColorOptions } = await import('@/constants/theme')

  useBoardStore.setState({ boards: [], activeBoardId: null })
  expect(selectedBoardRailColor('dark')).toBeNull()
  useBoardStore.setState({
    boards: [
      { id: 'first', personalization: { railId: 'x7', railColorId: 'cyan' } },
      { id: 'second', personalization: { railId: 'x7', railColorId: 'amber' } },
    ] as never,
    activeBoardId: 'first',
  })
  expect(selectedBoardRailColor('dark')).toBe(accentColors.dark.cyan.color)
  useBoardStore.setState({ activeBoardId: 'second' })
  expect(selectedBoardRailColor('dark')).toBe(accentColors.dark.amber.color)
  expect(selectedBoardRailColor('light')).toBe(accentColors.light.amber.color)
  useBoardStore.setState({
    boards: [{ id: 'mint', personalization: { railId: 'x7', railColorId: 'group-ride' } }] as never,
    activeBoardId: 'mint',
  })
  expect(selectedBoardRailColor('dark')).not.toBeNull()
  expect(selectedBoardRailColor('dark')).toBe(accentColors.dark.mint.color)
  expect(selectedBoardRailColor('light')).toBe(accentColors.light.mint.color)
  for (const { id } of personalizationColorOptions) {
    useBoardStore.setState({
      boards: [{ id: 'choice', personalization: { railId: 'x7', railColorId: id } }] as never,
      activeBoardId: 'choice',
    })
    for (const appearance of ['light', 'dark'] as const) {
      expect(selectedBoardRailColor(appearance)).toBe(
        accentColors[appearance][id === 'group-ride' ? 'mint' : id].color,
      )
    }
  }
  expect(accentColors.light.mint.color).not.toBe(accentColors.light.teal.color)
  useBoardStore.setState({
    boards: [{ id: 'unknown', personalization: { railId: 'x7', railColorId: 'unknown' } }] as never,
    activeBoardId: 'unknown',
  })
  expect(selectedBoardRailColor('dark')).toBeNull()
  useThemeStore.setState({ resolvedTheme: 'light' })
  useBoardStore.setState({ activeBoardId: null })
  expect(selectedBoardRailColor(useThemeStore.getState().resolvedTheme)).toBeNull()
})

test('native departure clears membership instead of retaining the previous ride id', async () => {
  const { useGroupRideStore } = await import('@/modules/group-ride/store/groupRideStore')
  useGroupRideStore.getState().startObserving()
  joinedListeners.forEach((listener) => listener({ rideId: 'r1' }))
  rosterListeners.forEach((listener) =>
    listener({
      rideId: 'r1',
      riders: [
        {
          id: 'peer',
          name: 'Peer',
          color: null,
          presence: null,
          stale: false,
          lastSeen: Date.now(),
        },
      ],
    }),
  )
  expect(useGroupRideStore.getState().rosterRows).toHaveLength(1)

  joinedListeners.forEach((listener) => listener({ rideId: null }))
  rosterListeners.forEach((listener) => listener({ rideId: null, riders: [] }))
  expect(useGroupRideStore.getState()).toMatchObject({
    activeRideId: null,
    roster: [],
    rosterRows: [],
  })
})

test('queued roster events cannot restore membership after an explicit leave', async () => {
  const { useGroupRideStore } = await import('@/modules/group-ride/store/groupRideStore')
  useGroupRideStore.getState().startObserving()
  const queuedRoster = {
    rideId: 'r1',
    riders: [
      { id: 'peer', name: 'Peer', color: null, presence: null, stale: false, lastSeen: Date.now() },
    ],
  }
  joinedListeners.forEach((listener) => listener({ rideId: 'r1' }))
  rosterListeners.forEach((listener) => listener(queuedRoster))
  useGroupRideStore.getState().leaveRide()
  expect(leaveGroupRide).toHaveBeenCalledTimes(1)

  // Presence was already queued on the bridge when the rider tapped Leave.
  rosterListeners.forEach((listener) => listener(queuedRoster))
  expect(useGroupRideStore.getState()).toMatchObject({
    activeRideId: null,
    roster: [],
    rosterRows: [],
  })
  joinedListeners.forEach((listener) => listener({ rideId: null }))
  rosterListeners.forEach((listener) => listener({ rideId: null, riders: [] }))
  rosterListeners.forEach((listener) => listener(queuedRoster))
  expect(useGroupRideStore.getState()).toMatchObject({
    activeRideId: null,
    roster: [],
    rosterRows: [],
  })

  // A subsequent real join still admits the roster for that ride.
  joinedListeners.forEach((listener) => listener({ rideId: 'r1' }))
  rosterListeners.forEach((listener) => listener(queuedRoster))
  expect(useGroupRideStore.getState().activeRideId).toBe('r1')
  expect(useGroupRideStore.getState().rosterRows).toHaveLength(1)
})
