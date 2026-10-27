import { expect, test } from 'bun:test'
import { rideExportOptions } from './rideExport'

const ride = {
  boardId: 'board',
  boardName: 'Board',
  startAtMs: 100,
  endAtMs: 900,
  movingStartAtMs: 300,
  movingEndAtMs: 700,
}

test('ride export keeps the full Board range independent of movement bounds', () => {
  expect(rideExportOptions(ride, null)).toEqual({
    fromMs: 100,
    toMs: 900,
    boardId: 'board',
    name: 'Board',
  })
})

test('Favorite export uses the exact saved Board/range', () => {
  expect(
    rideExportOptions(ride, {
      boardId: 'favorite-board',
      startMs: 250,
      endMs: 550,
      name: '../Evening & ride',
    }),
  ).toEqual({ fromMs: 250, toMs: 550, boardId: 'favorite-board', name: '../Evening & ride' })
})

test('unassigned Board export omits the Board', () => {
  expect(rideExportOptions({ ...ride, boardId: null }, null)).toEqual({
    fromMs: 100,
    toMs: 900,
    boardId: undefined,
    name: 'Board',
  })
})
