import { describe, expect, test } from 'bun:test'

import {
  EMPTY_RIDE_SELECT,
  rideDayState,
  selectedRideCount,
  toRideSelection,
  toggleRides,
  type RideSelect,
} from '@/modules/history/lib/rideSelect'
import type { HistorySession } from '@/modules/history/lib/sessions'

const ride = (id: string, startAtMs: number) =>
  ({ id, startAtMs, endAtMs: startAtMs + 10, boardId: 'b', boardName: 'Pint' }) as HistorySession

describe('ride select', () => {
  test('a day header ticks the whole day, then unticks it', () => {
    const partly = toggleRides(EMPTY_RIDE_SELECT, ['a'])
    expect(rideDayState(partly, ['a', 'b'])).toBe('some')
    const day = toggleRides(partly, ['a', 'b'])
    expect(rideDayState(day, ['a', 'b'])).toBe('all')
    expect(rideDayState(toggleRides(day, ['a', 'b']), ['a', 'b'])).toBe('none')
  })

  test('select all counts the filter matches minus the unticked rides', () => {
    const all: RideSelect = { all: true, excluded: new Set() }
    const unticked = toggleRides(all, ['a'])
    expect(selectedRideCount(unticked, 40)).toBe(39)
    expect(rideDayState(unticked, ['a', 'b'])).toBe('some')
    expect(selectedRideCount(toggleRides(unticked, ['a']), 40)).toBe(40)
  })

  test('history "all" stays a filter so native resolves unloaded rides', () => {
    const select = toggleRides({ all: true, excluded: new Set() }, ['a'])
    expect(toRideSelection(select, [ride('a', 1)], null, { boardIds: ['b'] })).toEqual({
      filter: { boardIds: ['b'] },
      excludeIds: ['a'],
    })
  })

  test('picked rides and favorites name their windows', () => {
    const select = toggleRides(EMPTY_RIDE_SELECT, ['b'])
    expect(toRideSelection(select, [ride('a', 1), ride('b', 100)], null, {})).toEqual({
      rides: [{ fromMs: 100, toMs: 110, boardId: 'b', name: 'Pint' }],
    })
    const favorite = { id: 'f', boardId: 'b', startMs: 102, endMs: 105, name: 'Jump' }
    const favorites = new Map([['b', favorite as never]])
    expect(
      toRideSelection({ all: true, excluded: new Set() }, [ride('b', 100)], favorites, {}),
    ).toEqual({ rides: [{ fromMs: 102, toMs: 105, boardId: 'b', name: 'Jump' }] })
  })
})
