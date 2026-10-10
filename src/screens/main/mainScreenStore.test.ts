import { beforeEach, describe, expect, test } from 'bun:test'

import { useMainScreenStore } from '@/screens/main/mainScreenStore'

beforeEach(() => {
  useMainScreenStore.getState().reset()
})

describe('mainScreenStore', () => {
  test('starts in live telemetry mode with collapsed map selectors', () => {
    const state = useMainScreenStore.getState()

    expect(state.mode).toBe('telemetry')
    expect(state.historySheetVisible).toBe(false)
    expect(state.mapSelector).toBe(null)
    expect(state.perspectiveEnabled).toBe(true)
  })

  test('keeps only one compact map selector open', () => {
    const store = useMainScreenStore.getState()

    store.enterMap()
    store.setMapSelector('navigation')
    expect(useMainScreenStore.getState().mapSelector).toBe('navigation')

    store.setMapSelector('style')
    expect(useMainScreenStore.getState().mapSelector).toBe('style')

    store.enterTelemetry()
    expect(useMainScreenStore.getState().mapSelector).toBe(null)
  })

  test('clears map selectors on map interaction and when leaving map mode', () => {
    const store = useMainScreenStore.getState()
    let changes = 0
    const unsubscribe = useMainScreenStore.subscribe(() => {
      changes += 1
    })

    store.dismissMapSelector()
    expect(changes).toBe(0)
    unsubscribe()

    store.enterMap()
    store.setMapSelector('style')
    store.dismissMapSelector()
    expect(useMainScreenStore.getState().mapSelector).toBe(null)

    store.setMapSelector('navigation')
    store.enterWeather()
    expect(useMainScreenStore.getState().mapSelector).toBe(null)

    store.enterMap()
    store.setMapSelector('style')
    store.enterHistory()
    expect(useMainScreenStore.getState().mapSelector).toBe(null)
  })

  test('transitions between center screen modes', () => {
    const store = useMainScreenStore.getState()

    store.enterMap()
    expect(useMainScreenStore.getState().mode).toBe('map')

    store.enterHistory()
    expect(useMainScreenStore.getState().mode).toBe('history')

    store.enterTelemetry()
    expect(useMainScreenStore.getState().mode).toBe('telemetry')
  })

  test('clears ride review UI state when returning to telemetry', () => {
    const store = useMainScreenStore.getState()

    store.setHistorySheetVisible(true)
    store.enterTelemetry()

    const state = useMainScreenStore.getState()
    expect(state.mode).toBe('telemetry')
    expect(state.historySheetVisible).toBe(false)
  })

  test('ends Favorite trimming when the ride context changes', () => {
    const store = useMainScreenStore.getState()

    store.beginTrim({ startMs: 1_000, endMs: 2_000 })
    store.setHistoryTab('favorites')
    expect(useMainScreenStore.getState().trimRange).toBe(null)

    useMainScreenStore.getState().beginTrim({ startMs: 3_000, endMs: 4_000 })
    useMainScreenStore.getState().openFavorite('favorite-1')
    expect(useMainScreenStore.getState().trimRange).toBe(null)
  })
})
