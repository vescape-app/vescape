import { beforeEach, expect, mock, test } from 'bun:test'

const actualVescapeCore = await import('@/../modules/vescape-core/src/index')

let settings = {
  directionPointLatitude: null as number | null,
  directionPointLongitude: null as number | null,
}
let writeError: Error | null = null

const setDirectionPoint = mock(async (latitude: number | null, longitude: number | null) => {
  if (writeError) throw writeError
  settings = { directionPointLatitude: latitude, directionPointLongitude: longitude }
})
const getSettings = mock(async () => settings)

mock.module('vescape-core', () => ({
  ...actualVescapeCore,
  setDirectionPoint,
  getSettings,
}))

const { useMapStore } = await import('@/modules/map/store/mapStore')

beforeEach(() => {
  settings = { directionPointLatitude: null, directionPointLongitude: null }
  writeError = null
  useMapStore.setState({
    directionPoint: null,
    navigation: null,
    acceptedNavigationComputedAtMs: null,
    error: null,
  })
  setDirectionPoint.mockClear()
  getSettings.mockClear()
})

/** The direction target is personal client state and never reaches the Map Point API. */
test('the direction point round-trips through native settings', async () => {
  await useMapStore.getState().setDirectionPoint(52.5, 21.5)
  expect(setDirectionPoint).toHaveBeenCalledWith(52.5, 21.5)

  useMapStore.setState({ directionPoint: null })
  await useMapStore.getState().loadDirectionPoint()
  expect(useMapStore.getState().directionPoint).toEqual({ latitude: 52.5, longitude: 21.5 })

  await useMapStore.getState().clearDirectionPoint()
  expect(setDirectionPoint).toHaveBeenLastCalledWith(null, null)
  expect(useMapStore.getState().directionPoint).toBeNull()
})

/** Native owns the target, so a refused write must not leave the map showing a target it lost. */
test('a refused write puts the previous direction point back', async () => {
  await useMapStore.getState().setDirectionPoint(52.5, 21.5)

  writeError = new Error('nope')
  await useMapStore.getState().setDirectionPoint(10, 10)

  const state = useMapStore.getState()
  expect(state.directionPoint).toEqual({ latitude: 52.5, longitude: 21.5 })
  expect(state.error).toBe('Could not save the direction point.')
})

test('clearing an already empty direction point does not write', async () => {
  await useMapStore.getState().clearDirectionPoint()
  expect(setDirectionPoint).not.toHaveBeenCalled()
})

test('accepted navigation survives the same native snapshot and resets for a replacement', () => {
  const navigation = {
    target: { latitude: 52.5, longitude: 21.5 },
    profile: 'walking' as const,
    computedAtMs: 1_000,
    status: 'ready' as const,
    distanceMeters: 2_000,
    durationSeconds: 600,
    coordinates: [
      [21.4, 52.4],
      [21.5, 52.5],
    ] as [number, number][],
  }

  useMapStore.getState().replaceNavigation(navigation, false)
  useMapStore.getState().acceptNavigation()
  useMapStore.getState().replaceNavigation(navigation, false)
  expect(useMapStore.getState().acceptedNavigationComputedAtMs).toBe(1_000)

  useMapStore.getState().replaceNavigation({ ...navigation, computedAtMs: 2_000 }, false)
  expect(useMapStore.getState().acceptedNavigationComputedAtMs).toBeNull()
})
