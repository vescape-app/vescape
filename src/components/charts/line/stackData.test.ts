import { expect, test } from 'bun:test'

import { toScrubTargets } from '@/components/charts/line/scrubTargets'
import type { PreparedChart } from '@/components/charts/line/stackData'

test('resolves chart colors before passing scrub targets to Skia', () => {
  const adaptiveColor = { resource_paths: ['@color/vescape_telemetry_speed'] } as unknown as string
  const chart: PreparedChart = {
    key: 'speed',
    height: 100,
    left: { range: { min: 0, max: 40 } },
    series: [
      {
        key: 'speed',
        data: { ts: [0, 1], vs: [0, 1] },
        paths: {} as PreparedChart['series'][number]['paths'],
        color: adaptiveColor,
      },
    ],
  }

  const targets = toScrubTargets(chart, (color) => (color === adaptiveColor ? '#0369a1' : color))

  expect(targets[0].color).toBe('#0369a1')
})
