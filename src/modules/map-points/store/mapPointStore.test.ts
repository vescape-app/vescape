import { beforeEach, expect, mock, test } from 'bun:test'
import type { MapPoint, MapPointCategory, MapPointPatch, MapPointReaction } from 'vescape-core'

const actualVescapeCore = await import('@/../modules/vescape-core/src/index')

/** One server-shaped Map Point; only the fields a test cares about need overriding. */
function serverPoint(overrides: Partial<MapPoint> & Pick<MapPoint, 'id'>): MapPoint {
  return {
    category: 'drop',
    latitude: 52.1,
    longitude: 21.1,
    name: null,
    description: null,
    score: 0,
    myReaction: null,
    ownedByMe: false,
    distanceMeters: 100,
    createdAt: '2026-07-29T10:00:00.000Z',
    updatedAt: '2026-07-29T10:00:00.000Z',
    ...overrides,
  }
}

/** Native rejects with a coded error; the store turns the code into rider-facing words. */
class ApiError extends Error {
  constructor(readonly code: string) {
    super(code)
  }
}

let nearbyResult: { items: MapPoint[]; truncated: boolean } = { items: [], truncated: false }
let nearbyError: Error | null = null
let writeError: Error | null = null
/** Set to hold the next read open, so a second read can be started mid-flight. */
let releaseNearby: (() => void) | null = null

const getNearbyMapPoints = mock(async (_lat: number, _lng: number, _radius: number) => {
  if (releaseNearby !== null) {
    await new Promise<void>((resolve) => {
      releaseNearby = resolve
    })
  }
  if (nearbyError) throw nearbyError
  return nearbyResult
})
const createMapPoint = mock(
  async (values: { category: MapPointCategory; latitude: number; longitude: number }) => {
    if (writeError) throw writeError
    return serverPoint({ id: 'created-1', ...values })
  },
)
const updateMapPoint = mock(async (id: string, patch: MapPointPatch) => {
  if (writeError) throw writeError
  return serverPoint({ id, ...patch })
})
const deleteMapPoint = mock(async (_id: string) => {
  if (writeError) throw writeError
})
const setMapPointReaction = mock(async (_id: string, _reaction: MapPointReaction | null) => {
  if (writeError) throw writeError
})

mock.module('vescape-core', () => ({
  ...actualVescapeCore,
  getNearbyMapPoints,
  createMapPoint,
  updateMapPoint,
  deleteMapPoint,
  setMapPointReaction,
}))

const { useMapPointStore } = await import('@/modules/map-points/store/mapPointStore')

beforeEach(() => {
  nearbyResult = { items: [], truncated: false }
  nearbyError = null
  releaseNearby = null
  writeError = null
  useMapPointStore.setState({
    mapPoints: [],
    truncated: false,
    loading: false,
    error: null,
    selectedMapPointId: null,
    hiddenMapPointCategories: [],
    lastRead: null,
  })
  for (const fn of [
    getNearbyMapPoints,
    createMapPoint,
    updateMapPoint,
    deleteMapPoint,
    setMapPointReaction,
  ]) {
    fn.mockClear()
  }
})

test('a nearby read renders the server answer nearest first', async () => {
  nearbyResult = {
    items: [
      serverPoint({ id: 'far', distanceMeters: 900 }),
      serverPoint({ id: 'near', distanceMeters: 20 }),
    ],
    truncated: true,
  }

  await useMapPointStore.getState().refreshNearby(52.1, 21.1, 14)

  const state = useMapPointStore.getState()
  expect(state.mapPoints.map((point) => point.id)).toEqual(['near', 'far'])
  expect(state.truncated).toBe(true)
  expect(state.error).toBeNull()
})

test('a camera nudge inside the last radius does not re-read', async () => {
  await useMapPointStore.getState().refreshNearby(52.1, 21.1, 14)
  await useMapPointStore.getState().refreshNearby(52.1001, 21.1001, 14)

  expect(getNearbyMapPoints).toHaveBeenCalledTimes(1)
})

/** The new circle sits inside the one already read, so its points are already on screen. */
test('zooming into an already-read area does not re-read', async () => {
  nearbyResult = { items: [serverPoint({ id: 'a' })], truncated: false }
  await useMapPointStore.getState().refreshNearby(52.1, 21.1, 12)
  await useMapPointStore.getState().refreshNearby(52.1, 21.1, 15)

  expect(getNearbyMapPoints).toHaveBeenCalledTimes(1)
})

/** Unless the server said there were more than it returned — then zooming in reveals them. */
test('zooming into a truncated area re-reads', async () => {
  nearbyResult = { items: [serverPoint({ id: 'a' })], truncated: true }
  await useMapPointStore.getState().refreshNearby(52.1, 21.1, 12)
  await useMapPointStore.getState().refreshNearby(52.1, 21.1, 15)

  expect(getNearbyMapPoints).toHaveBeenCalledTimes(2)
})

test('panning far enough re-reads around the new centre', async () => {
  await useMapPointStore.getState().refreshNearby(52.1, 21.1, 14)
  await useMapPointStore.getState().refreshNearby(52.4, 21.6, 14)

  expect(getNearbyMapPoints).toHaveBeenCalledTimes(2)
})

/** Map Points are server-owned, so a failed read has nothing to fall back on. */
test('a failed read empties the map and reports why', async () => {
  nearbyResult = { items: [serverPoint({ id: 'a' })], truncated: false }
  await useMapPointStore.getState().refreshNearby(52.1, 21.1, 14)

  nearbyError = new ApiError('MAP_POINT_UNREACHABLE')
  await useMapPointStore.getState().reload()

  const state = useMapPointStore.getState()
  expect(state.mapPoints).toEqual([])
  expect(state.error).toBe('Could not reach the server. Map features need a connection.')
})

/** Offline, every camera idle retries and fails; a fresh [] each time re-rendered the map tree. */
test('repeated failed reads keep the same empty set', async () => {
  nearbyError = new ApiError('MAP_POINT_UNREACHABLE')
  await useMapPointStore.getState().refreshNearby(52.1, 21.1, 14)
  const empty = useMapPointStore.getState().mapPoints

  await useMapPointStore.getState().refreshNearby(52.1, 21.1, 14)

  expect(useMapPointStore.getState().mapPoints).toBe(empty)
})

/** Otherwise a rider parked on the spot would sit on an empty map until they panned far enough. */
test('a still camera retries after a failed read', async () => {
  nearbyError = new ApiError('MAP_POINT_UNREACHABLE')
  await useMapPointStore.getState().refreshNearby(52.1, 21.1, 14)

  nearbyError = null
  nearbyResult = { items: [serverPoint({ id: 'a' })], truncated: false }
  await useMapPointStore.getState().refreshNearby(52.1, 21.1, 14)

  expect(getNearbyMapPoints).toHaveBeenCalledTimes(2)
  expect(useMapPointStore.getState().mapPoints.map((point) => point.id)).toEqual(['a'])
  expect(useMapPointStore.getState().error).toBeNull()
})

/**
 * The camera only idles again when the rider moves it again, so a target dropped mid-flight would
 * strand the map on the previous area.
 */
test('a camera move during a read is served once the read settles', async () => {
  nearbyResult = { items: [serverPoint({ id: 'first' })], truncated: false }
  releaseNearby = () => {}
  const first = useMapPointStore.getState().refreshNearby(52.1, 21.1, 14)

  const second = useMapPointStore.getState().refreshNearby(52.4, 21.6, 14)
  nearbyResult = { items: [serverPoint({ id: 'second' })], truncated: false }
  releaseNearby?.()
  releaseNearby = null
  await Promise.all([first, second])

  expect(getNearbyMapPoints).toHaveBeenCalledTimes(2)
  expect(getNearbyMapPoints.mock.calls[1]?.slice(0, 2)).toEqual([52.4, 21.6])
  expect(useMapPointStore.getState().mapPoints.map((point) => point.id)).toEqual(['second'])
  expect(useMapPointStore.getState().loading).toBe(false)
})

test('creating a Map Point adds the server row, not a local guess', async () => {
  const point = await useMapPointStore.getState().addMapPoint('bonk', 52.2, 21.2)

  expect(createMapPoint).toHaveBeenCalledWith({
    category: 'bonk',
    latitude: 52.2,
    longitude: 21.2,
  })
  expect(point?.id).toBe('created-1')
  expect(useMapPointStore.getState().mapPoints.map((candidate) => candidate.id)).toEqual([
    'created-1',
  ])
})

test('a refused write leaves the map alone and explains itself', async () => {
  writeError = new ApiError('MAP_POINT_SIGN_IN_REQUIRED')

  const point = await useMapPointStore.getState().addMapPoint('drop', 52.2, 21.2)

  expect(point).toBeNull()
  expect(useMapPointStore.getState().mapPoints).toEqual([])
  expect(useMapPointStore.getState().error).toBe('Sign in to add or change map features.')
})

test('voting is optimistic and adjusts the score locally', async () => {
  nearbyResult = { items: [serverPoint({ id: 'a', score: 3 })], truncated: false }
  await useMapPointStore.getState().refreshNearby(52.1, 21.1, 14)

  await useMapPointStore.getState().setMapPointReaction('a', 'up')
  expect(useMapPointStore.getState().mapPoints[0]).toMatchObject({ myReaction: 'up', score: 4 })

  await useMapPointStore.getState().setMapPointReaction('a', 'down')
  expect(useMapPointStore.getState().mapPoints[0]).toMatchObject({ myReaction: 'down', score: 2 })

  await useMapPointStore.getState().setMapPointReaction('a', null)
  expect(useMapPointStore.getState().mapPoints[0]).toMatchObject({ myReaction: null, score: 3 })
})

test('a rejected vote rolls back to the previous reaction', async () => {
  nearbyResult = { items: [serverPoint({ id: 'a', score: 3, myReaction: 'up' })], truncated: false }
  await useMapPointStore.getState().refreshNearby(52.1, 21.1, 14)
  writeError = new ApiError('MAP_POINT_UNREACHABLE')

  const result = await useMapPointStore.getState().setMapPointReaction('a', 'down')

  expect(result).toBeNull()
  expect(useMapPointStore.getState().mapPoints[0]).toMatchObject({ myReaction: 'up', score: 3 })
  expect(useMapPointStore.getState().error).toBe(
    'Could not reach the server. Map features need a connection.',
  )
})

test('deleting drops the point and its selection', async () => {
  nearbyResult = { items: [serverPoint({ id: 'a', ownedByMe: true })], truncated: false }
  await useMapPointStore.getState().refreshNearby(52.1, 21.1, 14)
  useMapPointStore.getState().selectMapPoint('a')

  const removed = await useMapPointStore.getState().removeMapPoint('a')

  expect(removed).toBe(true)
  expect(useMapPointStore.getState().mapPoints).toEqual([])
  expect(useMapPointStore.getState().selectedMapPointId).toBeNull()
})

test('a failed delete keeps the point on the map', async () => {
  nearbyResult = { items: [serverPoint({ id: 'a' })], truncated: false }
  await useMapPointStore.getState().refreshNearby(52.1, 21.1, 14)
  writeError = new ApiError('MAP_POINT_NOT_YOURS')

  const removed = await useMapPointStore.getState().removeMapPoint('a')

  expect(removed).toBe(false)
  expect(useMapPointStore.getState().mapPoints.map((point) => point.id)).toEqual(['a'])
  expect(useMapPointStore.getState().error).toBe(
    'Only the rider who added this feature can change it.',
  )
})

test('editing replaces the point with the server answer', async () => {
  nearbyResult = { items: [serverPoint({ id: 'a' })], truncated: false }
  await useMapPointStore.getState().refreshNearby(52.1, 21.1, 14)

  const point = await useMapPointStore.getState().editMapPoint('a', { name: 'Kicker' })

  expect(updateMapPoint).toHaveBeenCalledWith('a', { name: 'Kicker' })
  expect(point?.name).toBe('Kicker')
  expect(useMapPointStore.getState().mapPoints[0].name).toBe('Kicker')
})

test('a read drops a selection the server no longer returns', async () => {
  nearbyResult = { items: [serverPoint({ id: 'a' })], truncated: false }
  await useMapPointStore.getState().refreshNearby(52.1, 21.1, 14)
  useMapPointStore.getState().selectMapPoint('a')

  nearbyResult = { items: [serverPoint({ id: 'b' })], truncated: false }
  await useMapPointStore.getState().reload()

  expect(useMapPointStore.getState().selectedMapPointId).toBeNull()
})

test('category visibility toggles on and off', () => {
  useMapPointStore.getState().toggleMapPointCategoryVisibility('drop')
  expect(useMapPointStore.getState().hiddenMapPointCategories).toEqual(['drop'])

  useMapPointStore.getState().toggleMapPointCategoryVisibility('drop')
  expect(useMapPointStore.getState().hiddenMapPointCategories).toEqual([])
})
