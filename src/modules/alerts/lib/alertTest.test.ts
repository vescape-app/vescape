import { expect, test } from 'bun:test'

import {
  batteryDrainAlertTestEasing,
  getAlertThresholdValues,
  highRangeAlertTestEasing,
} from '@/modules/alerts/lib/alertTest'

test('high-range sweep reaches alerts early without extending the sweep', () => {
  expect(highRangeAlertTestEasing(0)).toBe(0)
  expect(highRangeAlertTestEasing(0.25)).toBeCloseTo(0.5781, 3)
  expect(highRangeAlertTestEasing(0.5)).toBeCloseTo(0.875)
  expect(highRangeAlertTestEasing(0.75)).toBeCloseTo(0.9844, 3)
  expect(highRangeAlertTestEasing(1)).toBe(1)
})

test('battery drain starts promptly and slows continuously toward empty', () => {
  expect(batteryDrainAlertTestEasing(0)).toBe(0)
  expect(batteryDrainAlertTestEasing(0.25)).toBeCloseTo(0.5781, 3)
  expect(batteryDrainAlertTestEasing(0.5)).toBeCloseTo(0.875)
  expect(batteryDrainAlertTestEasing(0.75)).toBeCloseTo(0.9844, 3)
  expect(batteryDrainAlertTestEasing(1)).toBe(1)
})

test('chart thresholds include range ceilings once in numeric order', () => {
  expect(
    getAlertThresholdValues([
      {
        id: 'range',
        controlId: 'duty',
        threshold: 80,
        thresholdMax: 90,
        spec: 'preset:tick',
        repeatEverySeconds: null,
      },
      {
        id: 'single',
        controlId: 'duty',
        threshold: 90,
        thresholdMax: null,
        spec: 'preset:beep',
        repeatEverySeconds: null,
      },
    ]),
  ).toEqual([80, 90])
})
