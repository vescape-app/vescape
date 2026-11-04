import { expect, test } from 'bun:test'
import { historyListRows, historyListLayouts } from './historyList'

const at = (day: number, hour: number) => new Date(2026, 9, day, hour).getTime()
const ride = (day: number, hour: number) => ({
  startAtMs: at(day, hour),
  endAtMs: at(day, hour + 1),
  movingStartAtMs: null,
  movingEndAtMs: null,
  distanceM: 1000 as number | null,
})

test('one date heading per day, including rides appended from another page', () => {
  const firstPage = [ride(16, 18), ride(16, 12)]
  const nextPage = [ride(16, 8), ride(15, 20), ride(15, 10)]
  const rows = historyListRows([...firstPage, ...nextPage])
  expect(rows.map((row) => row.dateHeader)).toEqual([
    '16 Oct 2026',
    null,
    null,
    '15 Oct 2026',
    null,
  ])
  expect(rows.map((row) => row.session)).toEqual([...firstPage, ...nextPage])
})

test('group by the displayed moving start, keeping overnight rides on their start day', () => {
  const overnight = {
    ...ride(15, 23),
    endAtMs: at(16, 2),
    movingStartAtMs: at(16, 0),
    movingEndAtMs: at(16, 1),
  }
  const rows = historyListRows([overnight, ride(15, 23)])
  expect(rows.map((row) => row.dateHeader)).toEqual(['16 Oct 2026', '15 Oct 2026'])
  expect(rows[0].window).toEqual({ startMs: at(16, 0), endMs: at(16, 1) })
  expect(rows[1].window.endMs).toBe(at(16, 0))
  expect(historyListRows([])).toEqual([])
})

test('exact frames include date headers and gaps across appended pages without moving existing rows', () => {
  const firstPage = [ride(16, 18), ride(16, 12)]
  const layouts = historyListLayouts(historyListRows(firstPage), 38)
  const paged = historyListLayouts(historyListRows([...firstPage, ride(16, 8), ride(15, 20)]), 38)
  expect(paged.slice(0, 2)).toEqual(layouts)
  expect(paged).toEqual([
    { index: 0, offset: 0, length: 126, rowOffset: 38 },
    { index: 1, offset: 134, length: 88, rowOffset: 134 },
    { index: 2, offset: 230, length: 88, rowOffset: 230 },
    { index: 3, offset: 326, length: 126, rowOffset: 364 },
  ])
  expect(historyListLayouts(historyListRows(firstPage), 54)[1].rowOffset).toBe(150)
})

test('each date heading carries the totals of its loaded rides', () => {
  const rows = historyListRows([ride(16, 18), { ...ride(16, 12), distanceM: null }, ride(15, 20)])
  expect(rows.map((row) => row.day)).toEqual([
    { rides: 2, durationMs: 2 * 3_600_000, distanceM: 1000 },
    null,
    { rides: 1, durationMs: 3_600_000, distanceM: 1000 },
  ])
})
