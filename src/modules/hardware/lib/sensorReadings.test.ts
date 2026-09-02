import { describe, expect, it } from 'bun:test'

import { describeReading, describeReadings } from './sensorReadings'

describe('describeReadings', () => {
  it('drops the link bookkeeping the board sends for itself', () => {
    const rows = describeReadings(['seq', 'tempC', 'readMs', 'distanceMm'])
    expect(rows.map((r) => r.key)).toEqual(['tempC', 'distanceMm'])
  })

  it('names an unknown key after itself, so new hardware shows up unannounced', () => {
    expect(describeReading('lidarCm').label).toBe('lidarCm')
  })
})
