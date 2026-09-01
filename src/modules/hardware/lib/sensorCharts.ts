import type { ChartSpec } from '@/components/charts/line/types'

import { describeReading } from '@/modules/hardware/lib/sensorReadings'
import type { SensorFrame } from '@/modules/hardware/lib/parseSensorFrame'

/** Only the distance rows are charted, so they can have the height to be read at a glance. */
const CHART_HEIGHT = 120

/** Flat series get a readable band rather than an axis collapsed onto one value. */
const MIN_SPAN = 1

/**
 * One chart row per reading, sharing the stack's camera and time axis.
 *
 * A key missing from a frame is a gap in that series, not a zero: the ToF drops out when nothing
 * is in range, and drawing that as a floor would read as an object right against the sensor.
 */
export function buildSensorCharts(frames: SensorFrame[]): ChartSpec[] {
  const keys: string[] = []
  for (const frame of frames) {
    for (const key of Object.keys(frame.values)) if (!keys.includes(key)) keys.push(key)
  }

  const charts: ChartSpec[] = []
  for (const key of keys) {
    const ts: number[] = []
    const vs: number[] = []
    let min = Infinity
    let max = -Infinity
    let chartable = true
    let started = false
    for (const frame of frames) {
      const raw = frame.values[key]
      const reading = describeReading(key, raw ?? null)
      chartable = reading.chart
      if (!chartable) break

      // A sensor with a fixed range rides its ceiling when it reads nothing: "no target" means
      // "further than the range", and holding the line there keeps every distance row advancing
      // on the same head instead of one freezing while the other moves. Sensors without a range
      // have no such ceiling to sit on, so they gap instead.
      // `started` keeps the ceiling from inventing history: it only fills gaps between real
      // samples, never the stretch before the sensor first answered.
      if (raw == null && !started) continue
      const value = reading.value
      if (value == null) continue
      started = true

      ts.push(frame.atMs)
      vs.push(value)
      if (value < min) min = value
      if (value > max) max = value
    }
    if (!chartable || ts.length < 2) continue

    const spec = describeReading(key, null)
    // A fixed range keeps a distance row on one scale; everything else fits itself to its data.
    const pad = Math.max((max - min) * 0.1, MIN_SPAN / 2)
    const range = spec.range ?? { min: min - pad, max: max + pad }
    charts.push({
      key,
      label: spec.unit ? `${spec.label} (${spec.unit})` : spec.label,
      height: CHART_HEIGHT,
      series: [
        {
          key,
          data: { ts, vs },
          color: spec.color,
          label: spec.label,
          unit: spec.unit,
          decimals: spec.decimals,
        },
      ],
      left: { range },
    })
  }
  return charts
}
