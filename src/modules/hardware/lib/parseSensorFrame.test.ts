import { describe, expect, it } from 'bun:test'

import { parseSensorFrame } from './parseSensorFrame'

describe('parseSensorFrame', () => {
  it('reads a firmware frame', () => {
    expect(parseSensorFrame('{"upMs":1200,"tempC":41.5,"heapKb":210}', 7)).toEqual({
      atMs: 7,
      values: { upMs: 1200, tempC: 41.5, heapKb: 210 },
    })
  })

  it('keeps keys the app does not know yet', () => {
    expect(parseSensorFrame('{"distanceMm":420}', 1)?.values).toEqual({ distanceMm: 420 })
  })

  it('drops non-numeric and non-finite values', () => {
    expect(parseSensorFrame('{"tempC":41,"name":"hw","bad":null}', 1)?.values).toEqual({
      tempC: 41,
    })
  })

  it('ignores plain console lines and malformed JSON', () => {
    expect(parseSensorFrame('echo: ping', 1)).toBeNull()
    expect(parseSensorFrame('{"tempC":', 1)).toBeNull()
    expect(parseSensorFrame('[1,2]', 1)).toBeNull()
    expect(parseSensorFrame('{"name":"hw"}', 1)).toBeNull()
  })
})
