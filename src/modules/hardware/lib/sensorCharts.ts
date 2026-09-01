import type { ChartSpec } from '@/components/charts/line/types'

import type { HardwareSeries } from 'vescape-core'
import { describeReading } from '@/modules/hardware/lib/sensorReadings'

/** Only the distance rows are charted, so they can have the height to be read at a glance. */
const CHART_HEIGHT = 120

/**
 * Dresses the natively decimated series as chart rows. Nothing is computed here: the points, the
 * scale and the row order all arrive settled, and this only adds what native has no business
 * knowing — the label, the unit and the color.
 */
export function buildSensorCharts(series: readonly HardwareSeries[]): ChartSpec[] {
  return series.map((row) => {
    const spec = describeReading(row.key)
    const ts: number[] = []
    const vs: number[] = []
    for (let index = 0; index + 1 < row.points.length; index += 2) {
      ts.push(row.points[index] as number)
      vs.push(row.points[index + 1] as number)
    }
    return {
      key: row.key,
      label: spec.unit ? `${spec.label} (${spec.unit})` : spec.label,
      height: CHART_HEIGHT,
      series: [
        {
          key: row.key,
          data: { ts, vs },
          color: spec.color,
          label: spec.label,
          unit: spec.unit,
          decimals: spec.decimals,
        },
      ],
      left: { range: { min: row.min, max: row.max } },
    }
  })
}
