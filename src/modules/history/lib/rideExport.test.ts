import { expect, test } from 'bun:test'
import { rideExportOptions } from './rideExport'

const ride = {
  boardId: 'board',
  recordingId: 'recording',
  boardName: 'Board',
  startAtMs: 100,
  endAtMs: 900,
  movingStartAtMs: 300,
  movingEndAtMs: 700,
}

test('ride export keeps full range and recording identity independent of movement bounds', () => {
  expect(rideExportOptions(ride, null)).toEqual({
    fromMs: 100,
    toMs: 900,
    boardId: 'board',
    recordingId: 'recording',
    name: 'Board',
  })
})

test('Favorite export uses exact saved Board/range and omits the opened ride recording identity', () => {
  expect(
    rideExportOptions(ride, {
      boardId: 'favorite-board',
      startMs: 250,
      endMs: 550,
      name: '../Evening & ride',
    }),
  ).toEqual({ fromMs: 250, toMs: 550, boardId: 'favorite-board', name: '../Evening & ride' })
})

test('legacy and unassigned Board export preserve optional identity', () => {
  expect(rideExportOptions({ ...ride, boardId: null, recordingId: null }, null)).toEqual({
    fromMs: 100,
    toMs: 900,
    boardId: undefined,
    recordingId: undefined,
    name: 'Board',
  })
})
