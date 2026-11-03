import { expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

test('smoke telemetry outlives cold XCTest startup and the full CI flow budget', () => {
  const events = readFileSync(
    join(import.meta.dir, '../shared/fixtures/replay-thor301-1hz.jsonl'),
    'utf8',
  )
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
  const chunks = events.filter((event) => event.kind === 'ble-chunk' && event.direction === 'rx')
  // Thirty minutes of CI execution plus six minutes consumed by native warmup.
  expect(chunks.at(-1).t).toBeGreaterThan(36 * 60_000)
  expect(events.filter((event) => event.kind === 'meta')).toHaveLength(1)
  for (let index = 1; index < chunks.length; index++) {
    expect(chunks[index].t).toBeGreaterThanOrEqual(chunks[index - 1].t)
    expect(chunks[index].t - chunks[index - 1].t).toBeLessThan(30_000)
  }
})
