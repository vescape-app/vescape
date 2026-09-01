import { describe, expect, it } from 'bun:test'

import { buildSensorCharts } from './sensorCharts'

describe('buildSensorCharts', () => {
  it('unpacks the flat native series and keeps its scale and order', () => {
    const charts = buildSensorCharts([
      { key: 'distanceMm', points: [1, 10, 2, 40], min: 0, max: 40 },
      { key: 'rangeCm', points: [1, 12, 2, 14], min: 0, max: 40 },
    ])
    expect(charts.map((c) => c.key)).toEqual(['distanceMm', 'rangeCm'])
    expect(charts[0]?.series[0]?.data).toEqual({ ts: [1, 2], vs: [10, 40] })
    expect(charts[0]?.left.range).toEqual({ min: 0, max: 40 })
    expect(charts[0]?.label).toBe('Distance (ToF) (cm)')
  })
})
