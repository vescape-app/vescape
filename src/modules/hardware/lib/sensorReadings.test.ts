import { describe, expect, it } from 'bun:test'

import { describeReading, describeReadings } from './sensorReadings'

describe('describeReading', () => {
  it('shows both distance sensors in cm', () => {
    expect(describeReading('distanceMm', 77).text).toBe('7.7 cm')
    expect(describeReading('rangeCm', 12.34).text).toBe('12.3 cm')
  })

  it('clamps distances to the useful 0 to 40 cm reach', () => {
    expect(describeReading('distanceMm', 8000).value).toBe(40)
    expect(describeReading('rangeCm', -5).value).toBe(0)
    expect(describeReading('tempC', 900).value).toBe(900)
  })

  it('reads nothing as the ceiling for a ranged sensor', () => {
    expect(describeReading('distanceMm', null).text).toBe('40.0 cm')
    expect(describeReading('rangeCm', null).value).toBe(40)
  })

  it('reads nothing as a dash when the sensor has no ceiling', () => {
    expect(describeReading('tempC', null).text).toBe('-')
    expect(describeReading('tempC', null).value).toBeNull()
  })
})

describe('describeReadings', () => {
  it('drops the link bookkeeping the board sends for itself', () => {
    const rows = describeReadings(['seq', 'tempC', 'readMs', 'distanceMm'])
    expect(rows.map((r) => r.key)).toEqual(['tempC', 'distanceMm'])
  })
})
