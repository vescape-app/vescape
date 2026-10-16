import { expect, test } from 'bun:test'
import { historyListRows } from './historyList'

const at = (day: number, hour: number) => new Date(2026, 9, day, hour).getTime()
const ride = (day: number, hour: number) => ({
  startAtMs: at(day, hour),
  endAtMs: at(day, hour + 1),
  movingStartAtMs: null,
  movingEndAtMs: null,
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
