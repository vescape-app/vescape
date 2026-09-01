import type { ChartSpec } from '@/components/charts/line/types'

import { describeReading, readingValue } from '@/modules/hardware/lib/sensorReadings'
import type { SensorFrame } from '@/modules/hardware/lib/parseSensorFrame'

/** Only the distance rows are charted, so they can have the height to be read at a glance. */
const CHART_HEIGHT = 120

/** Flat series get a readable band rather than an axis collapsed onto one value. */
const MIN_SPAN = 1

/**
 * Most points worth drawing in one row. A phone chart is a few hundred pixels wide, so at fifty
 * samples a second the history is several points per pixel long before it fills; keeping them all
 * costs a redraw and shows nothing extra. The newest sample is always kept, so the head is live.
 */
const MAX_POINTS = 400

/**
 * One chart row per reading, sharing the stack's camera and time axis.
 *
 * `keys` fixes the row order and must be the same list the readings rows use — the log's
 * first-seen order for the whole link. Deriving it from the frames on screen instead reorders the
 * stack whenever a sensor drops out and comes back, because it is then "first seen" last.
 *
 * A key missing from a frame is a gap in that series, not a zero: the ToF drops out when nothing
 * is in range, and drawing that as a floor would read as an object right against the sensor.
 *
 * `firstSeen` is when each key first carried a value. A ranged sensor that has answered before the
 * window opened rides its ceiling across the whole window rather than losing its row: a sensor
 * with nothing in reach still has something to say, and a row that comes and goes moves every
 * other row on the screen.
 */
export function buildSensorCharts(
  frames: readonly SensorFrame[],
  keys: readonly string[],
  firstSeen: ReadonlyMap<string, number> = new Map(),
): ChartSpec[] {
  const stride = Math.max(1, Math.ceil(frames.length / MAX_POINTS))

  const charts: ChartSpec[] = []
  for (const key of keys) {
    const spec = describeReading(key, null)
    if (!spec.chart) continue

    const ts: number[] = []
    const vs: number[] = []
    let min = Infinity
    let max = -Infinity
    // Answered before this window opened, so the ceiling may fill from its very first frame.
    const since = firstSeen.get(key)
    let started = since != null && since <= (frames[0]?.atMs ?? Infinity)
    for (let index = 0; index < frames.length; index++) {
      const frame = frames[index]
      if (frame == null) continue
      const raw = frame.values[key]
      // Thinned from the oldest end so the head keeps its true rate: the last sample is what the
      // eye tracks, and dropping it would make the line lag the reading beside it.
      const keep = (frames.length - 1 - index) % stride === 0

      // A sensor with a fixed range rides its ceiling when it reads nothing: "no target" means
      // "further than the range", and holding the line there keeps every distance row advancing
      // on the same head instead of one freezing while the other moves. Sensors without a range
      // have no such ceiling to sit on, so they gap instead.
      // `started` keeps the ceiling from inventing history: it only fills gaps between real
      // samples, never the stretch before the sensor first answered.
      if (raw == null && !started) continue
      const value = readingValue(key, raw ?? null)
      if (value == null) continue
      started = true
      if (!keep) continue

      ts.push(frame.atMs)
      vs.push(value)
      if (value < min) min = value
      if (value > max) max = value
    }
    if (ts.length < 2) continue

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
