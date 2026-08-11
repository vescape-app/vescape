import { beforeEach, expect, mock, test } from 'bun:test'

import type { Favorite } from 'vescape-core'

const actualVescapeCore = await import('@/../modules/vescape-core/src/index')

function favorite(overrides: Partial<Favorite> & Pick<Favorite, 'id' | 'startMs'>): Favorite {
  return {
    boardId: 'board-uuid-1',
    boardName: 'Onewheel',
    name: null,
    endMs: overrides.startMs + 60_000,
    createdAtMs: 1_700_000_000_000,
    updatedAtMs: 1_700_000_000_000,
    sampleCount: 120,
    gpsPointCount: 20,
    distanceM: 1_180,
    movingDurationMs: 59_000,
    avgSpeedKmh: 20,
    maxSpeedKmh: 32,
    batteryUsedWh: 12.5,
    ...overrides,
  }
}

const getFavorites = mock(async () => [] as Favorite[])
const createFavorite = mock(async (): Promise<Favorite> => {
  throw new Error('createFavorite not stubbed')
})
const updateFavorite = mock(async (): Promise<Favorite> => {
  throw new Error('updateFavorite not stubbed')
})
const deleteFavorite = mock(async () => true)

const vescapeCoreMock = {
  ...actualVescapeCore,
  getFavorites,
  createFavorite,
  updateFavorite,
  deleteFavorite,
}

mock.module('vescape-core', () => vescapeCoreMock)
mock.module('../../modules/vescape-core/src/index', () => vescapeCoreMock)

beforeEach(async () => {
  getFavorites.mockClear()
  createFavorite.mockClear()
  updateFavorite.mockClear()
  deleteFavorite.mockClear()
  getFavorites.mockImplementation(async () => [])
  createFavorite.mockImplementation(async () => {
    throw new Error('createFavorite not stubbed')
  })
  updateFavorite.mockImplementation(async () => {
    throw new Error('updateFavorite not stubbed')
  })
  deleteFavorite.mockImplementation(async () => true)
  const { useFavoriteStore } = await import('@/modules/history/store/favoriteStore')
  useFavoriteStore.setState({ favorites: [], loading: false, saving: false, error: undefined })
})

test('loads favorites from native', async () => {
  const stored = favorite({ id: 'fav-1', startMs: 2_000_000 })
  getFavorites.mockImplementation(async () => [stored])
  const { useFavoriteStore } = await import('@/modules/history/store/favoriteStore')

  await useFavoriteStore.getState().load()

  expect(useFavoriteStore.getState().favorites).toEqual([stored])
  expect(useFavoriteStore.getState().loading).toBe(false)
})

test('keeps the list newest first after adding a favorite', async () => {
  const older = favorite({ id: 'older', startMs: 1_000_000 })
  const newer = favorite({ id: 'newer', startMs: 3_000_000 })
  getFavorites.mockImplementation(async () => [older])
  createFavorite.mockImplementation(async () => newer)
  const { useFavoriteStore } = await import('@/modules/history/store/favoriteStore')

  await useFavoriteStore.getState().load()
  await useFavoriteStore.getState().add({ startMs: newer.startMs, endMs: newer.endMs })

  expect(useFavoriteStore.getState().favorites.map((f) => f.id)).toEqual(['newer', 'older'])
})

test('does not let a stale load overwrite a favorite added while it was in flight', async () => {
  const created = favorite({ id: 'newer', startMs: 3_000_000 })
  let resolveLoad: (favorites: Favorite[]) => void = () => {}
  getFavorites.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveLoad = resolve
      }),
  )
  createFavorite.mockImplementation(async () => created)
  const { useFavoriteStore } = await import('@/modules/history/store/favoriteStore')

  const load = useFavoriteStore.getState().load()
  await Promise.resolve()
  await useFavoriteStore.getState().add({ startMs: created.startMs, endMs: created.endMs })
  resolveLoad([])
  await load

  expect(useFavoriteStore.getState().favorites).toEqual([created])
  expect(useFavoriteStore.getState().loading).toBe(false)
})

test('does not apply a load snapshot taken during an in-flight favorite mutation', async () => {
  const created = favorite({ id: 'newer', startMs: 3_000_000 })
  let resolveCreate: (favorite: Favorite) => void = () => {}
  let resolveLoad: (favorites: Favorite[]) => void = () => {}
  createFavorite.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveCreate = resolve
      }),
  )
  getFavorites.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveLoad = resolve
      }),
  )
  const { useFavoriteStore } = await import('@/modules/history/store/favoriteStore')

  const add = useFavoriteStore.getState().add({ startMs: created.startMs, endMs: created.endMs })
  await Promise.resolve()
  const load = useFavoriteStore.getState().load()
  resolveCreate(created)
  await add
  resolveLoad([])
  await load

  expect(useFavoriteStore.getState().favorites).toEqual([created])
  expect(useFavoriteStore.getState().loading).toBe(false)
})

test('surfaces a create failure instead of inserting a phantom row', async () => {
  createFavorite.mockImplementation(async () => {
    throw new Error('range has no samples')
  })
  const { useFavoriteStore } = await import('@/modules/history/store/favoriteStore')

  const created = await useFavoriteStore.getState().add({ startMs: 1_000, endMs: 2_000 })

  expect(created).toBeNull()
  expect(useFavoriteStore.getState().favorites).toEqual([])
  expect(useFavoriteStore.getState().error).toBe('range has no samples')
})

test('removes only the deleted favorite', async () => {
  const kept = favorite({ id: 'kept', startMs: 1_000_000 })
  getFavorites.mockImplementation(async () => [favorite({ id: 'gone', startMs: 2_000_000 }), kept])
  const { useFavoriteStore } = await import('@/modules/history/store/favoriteStore')

  await useFavoriteStore.getState().load()
  await useFavoriteStore.getState().remove('gone')

  expect(deleteFavorite).toHaveBeenCalledWith('gone')
  expect(useFavoriteStore.getState().favorites).toEqual([kept])
})

test('a second star tap while a create is in flight does not add a duplicate', async () => {
  const created = favorite({ id: 'fav-1', startMs: 2_000_000 })
  createFavorite.mockImplementation(async () => created)
  const { useFavoriteStore } = await import('@/modules/history/store/favoriteStore')

  const [first, second] = await Promise.all([
    useFavoriteStore.getState().add({ startMs: created.startMs, endMs: created.endMs }),
    useFavoriteStore.getState().add({ startMs: created.startMs, endMs: created.endMs }),
  ])

  expect(createFavorite).toHaveBeenCalledTimes(1)
  expect([first, second]).toEqual([created, null])
  expect(useFavoriteStore.getState().favorites).toEqual([created])
  expect(useFavoriteStore.getState().saving).toBe(false)
})

test('an update mirrors and re-sorts the row native returns without touching the others', async () => {
  const other = favorite({ id: 'other', startMs: 3_000_000 })
  const updated = favorite({ id: 'fav-1', startMs: 4_000_000, name: 'Dolina single track' })
  getFavorites.mockImplementation(async () => [
    other,
    favorite({ id: 'fav-1', startMs: 1_000_000 }),
  ])
  updateFavorite.mockImplementation(async () => updated)
  const { useFavoriteStore } = await import('@/modules/history/store/favoriteStore')

  await useFavoriteStore.getState().load()
  await useFavoriteStore.getState().update('fav-1', {
    startMs: 4_000_000,
    endMs: 4_060_000,
    name: 'Dolina single track',
  })

  expect(updateFavorite).toHaveBeenCalledWith('fav-1', {
    startMs: 4_000_000,
    endMs: 4_060_000,
    name: 'Dolina single track',
  })
  expect(useFavoriteStore.getState().favorites).toEqual([updated, other])
})

test('a failed update leaves the stored Favorite alone and surfaces the error', async () => {
  const stored = favorite({ id: 'fav-1', startMs: 1_000_000, name: 'Dolina' })
  getFavorites.mockImplementation(async () => [stored])
  updateFavorite.mockImplementation(async () => {
    throw new Error('favorite does not exist')
  })
  const { useFavoriteStore } = await import('@/modules/history/store/favoriteStore')

  await useFavoriteStore.getState().load()
  const updated = await useFavoriteStore.getState().update('fav-1', {
    startMs: 1_000_000,
    endMs: 1_060_000,
    name: null,
  })

  expect(updated).toBeNull()
  expect(useFavoriteStore.getState().favorites).toEqual([stored])
  expect(useFavoriteStore.getState().error).toBe('favorite does not exist')
})
