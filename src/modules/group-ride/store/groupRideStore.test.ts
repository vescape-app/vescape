import { beforeEach, expect, mock, test } from 'bun:test'

type Listener<T> = (event: T) => void

const connectionListeners: Listener<{ state: string }>[] = []
const signalAvailabilityListeners: Listener<unknown>[] = []
const errorListeners: Listener<{ message: string }>[] = []
const locationListeners: Listener<{ latitude: number; longitude: number }>[] = []
const publicRideStatusListeners: Listener<unknown>[] = []
const publicRidersListeners: Listener<{ riders: unknown[]; now: number | null }>[] = []
const publicPinsListeners: Listener<unknown>[] = []
const setPublicRide = mock((_on: boolean, _until: number | null) => {})

const updateGroupRideIdentity = mock(() => {})
const startGroupRideObserve = mock(() => {})
const stopGroupRideObserve = mock(() => {})
const watchPublicRiders = mock(() => {})
const stopWatchingPublicRiders = mock(() => {})
const getSettings = mock(
  async (): Promise<{ riderId: string | null; riderName: string | null }> => ({
    riderId: null,
    riderName: null,
  }),
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
  updateGroupRideIdentity,
  startGroupRideObserve,
  stopGroupRideObserve,
  watchPublicRiders,
  stopWatchingPublicRiders,
  getCompanionPresenceBoards: async () => [],
  addCompanionPresenceBoard: async () => undefined,
  removeCompanionPresenceBoard: async () => undefined,
  setCompanionPresenceEnabled: async () => undefined,
  getSettings,
  updateSetting,
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
  updateGroupRideIdentity.mockClear()
  startGroupRideObserve.mockClear()
  stopGroupRideObserve.mockClear()
  watchPublicRiders.mockClear()
  stopWatchingPublicRiders.mockClear()
  setPublicRide.mockClear()
  getSettings.mockReset()
  getSettings.mockImplementation(async () => ({ riderId: null, riderName: null }))
  updateSetting.mockReset()
  updateSetting.mockImplementation(async () => {})
  const { useGroupRideStore } = await import('@/modules/group-ride/store/groupRideStore')
  const { useRiderStore } = await import('@/modules/group-ride/store/riderStore')
  useGroupRideStore.setState({
    connection: 'idle',
    ownLocation: null,
    rosterRows: [],
    relayClock: null,
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

test('name edits while observing push the new identity to peers', async () => {
  const { useGroupRideStore } = await import('@/modules/group-ride/store/groupRideStore')
  const { useRiderStore } = await import('@/modules/group-ride/store/riderStore')

  useRiderStore.setState({ riderId: 'rider-1', riderName: 'Old', loaded: true })
  useGroupRideStore.getState().startObserving()

  await useRiderStore.getState().setName('  New Name  ')
  expect(updateGroupRideIdentity).toHaveBeenLastCalledWith({
    riderId: 'rider-1',
    riderName: 'New Name',
  })
})

test('a Rider Profile nick replaces the local name and reaches peers', async () => {
  const { useGroupRideStore } = await import('@/modules/group-ride/store/groupRideStore')
  const { useRiderStore } = await import('@/modules/group-ride/store/riderStore')
  const { useRiderProfileStore } = await import('@/modules/profile/store/riderProfileStore')

  useRiderStore.setState({ riderId: 'rider-1', riderName: 'Local', loaded: true })
  useGroupRideStore.getState().startObserving()

  useRiderProfileStore.setState({
    profile: { accountId: 'acc-1', nick: 'Kupa_99', nationality: 'PL' },
    loaded: true,
  })
  expect(updateGroupRideIdentity).toHaveBeenLastCalledWith({
    riderId: 'rider-1',
    riderName: 'Kupa_99',
  })

  useRiderProfileStore.getState().clear()
  expect(updateGroupRideIdentity).toHaveBeenLastCalledWith({
    riderId: 'rider-1',
    riderName: 'Local',
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

  const status = { on: true, until: null, live: true, supported: true, reason: null }
  publicRideStatusListeners.forEach((listener) => listener(status))
  expect(useGroupRideStore.getState().publicRide).toEqual(status)
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

  // The first fix re-centres look-around; later fixes do not.
  locationListeners.forEach((listener) => listener({ latitude: 1, longitude: 2 }))
  locationListeners.forEach((listener) => listener({ latitude: 1, longitude: 2 }))
  expect(watchPublicRiders).toHaveBeenCalledTimes(2)

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
