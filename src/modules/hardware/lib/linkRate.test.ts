import { describe, expect, it } from 'bun:test'

import { measureLinkRate } from '@/modules/hardware/lib/linkRate'
import type { SensorFrame } from '@/modules/hardware/lib/parseSensorFrame'

const frame = (atMs: number, seq: number): SensorFrame => ({ atMs, values: { seq, readMs: 8 } })

describe('measureLinkRate', () => {
  it('reports the delivered rate, not the number of frames', () => {
    const frames = [frame(0, 1), frame(50, 2), frame(100, 3)]
    expect(measureLinkRate(frames).hz).toBeCloseTo(20)
  })

  it('has no rate until two frames can be timed', () => {
    expect(measureLinkRate([frame(0, 1)]).hz).toBeNull()
  })

  it('counts notifications the board numbered but the app never got', () => {
    expect(measureLinkRate([frame(0, 1), frame(50, 4), frame(100, 5)]).dropped).toBe(2)
  })

  it('measures only the recent window, so an old stall stops counting', () => {
    const frames = [frame(0, 1), frame(9000, 20), frame(9050, 21), frame(9100, 22)]
    const rate = measureLinkRate(frames)
    expect(rate.dropped).toBe(0)
    expect(rate.hz).toBeCloseTo(20)
  })
})
