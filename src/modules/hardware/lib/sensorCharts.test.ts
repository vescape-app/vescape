import { describe, expect, it } from 'bun:test'

import type { SensorFrame } from './parseSensorFrame'
import { buildSensorCharts } from './sensorCharts'

const frames: SensorFrame[] = [
  { atMs: 1, values: { distanceMm: 100, rangeCm: 12 } },
  { atMs: 2, values: { rangeCm: 13 } },
  { atMs: 3, values: { distanceMm: 200, rangeCm: 14 } },
]

describe('buildSensorCharts', () => {
  it('charts distances only, on a fixed range', () => {
    const charts = buildSensorCharts([
      ...frames,
      { atMs: 4, values: { tempC: 40, heapKb: 200, upMs: 4000, rangeCm: 15 } },
    ])
    expect(charts.map((c) => c.key)).toEqual(['distanceMm', 'rangeCm'])
    expect(charts[0]?.left.range).toEqual({ min: 0, max: 40 })
  })

  it('holds a rangeless sensor at its ceiling so both rows share one head', () => {
    const tof = buildSensorCharts(frames)[0]
    expect(tof?.series[0]?.data.ts).toEqual([1, 2, 3])
    expect(tof?.series[0]?.data.vs).toEqual([10, 40, 20])
  })

  it('does not invent samples before a sensor first answers', () => {
    const charts = buildSensorCharts([{ atMs: 0, values: { rangeCm: 12 } }, ...frames])
    const tof = charts.find((c) => c.key === 'distanceMm')
    // Nothing at atMs 0, when the ToF had not reported yet; the ceiling only fills gaps after.
    expect(tof?.series[0]?.data.ts).toEqual([1, 2, 3])
    expect(tof?.series[0]?.data.vs).toEqual([10, 40, 20])
  })
})
