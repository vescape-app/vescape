import { describe, expect, it } from 'bun:test'

import { decodeBmsSeriesFrames } from './bmsSeries'

function encodedFrame(): Float64Array<ArrayBuffer> {
  // capturedAt, balance bits low/high, then three cell-group voltages.
  return new Float64Array([1_725_000_000_000, 0b010, 0, 4.072, 4.073, 4.071])
}

describe('decodeBmsSeriesFrames', () => {
  it('decodes an ArrayBuffer payload', () => {
    const frames = decodeBmsSeriesFrames({
      cellCount: 3,
      count: 1,
      columns: encodedFrame().buffer,
    })

    expect(frames).toEqual([
      {
        capturedAt: 1_725_000_000_000,
        cellVoltages: [4.072, 4.073, 4.071],
        balancing: [false, true, false],
      },
    ])
  })

  it('decodes the Uint8Array shape delivered by the native event bridge', () => {
    const frames = decodeBmsSeriesFrames({
      cellCount: 3,
      count: 1,
      columns: new Uint8Array(encodedFrame().buffer),
    })

    expect(frames[0]?.cellVoltages).toEqual([4.072, 4.073, 4.071])
  })

  it('respects a byte view offset instead of reading the whole backing buffer', () => {
    const encoded = new Uint8Array(encodedFrame().buffer)
    const backing = new Uint8Array(encoded.byteLength + 16)
    backing.set(encoded, 8)

    const frames = decodeBmsSeriesFrames({
      cellCount: 3,
      count: 1,
      columns: backing.subarray(8, 8 + encoded.byteLength),
    })

    expect(frames[0]).toEqual({
      capturedAt: 1_725_000_000_000,
      cellVoltages: [4.072, 4.073, 4.071],
      balancing: [false, true, false],
    })
  })
})
