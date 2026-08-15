import { expect, test } from 'bun:test'
import { ALERT_BEEP_COUNT_DEFAULT } from 'vescape-core'

import {
  batteryDrainAlertTestEasing,
  buildAlertTestRules,
  buildMetricAlertRuleSnapshot,
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

test('preset test rules are the exact visible preset snapshot', () => {
  expect(
    buildAlertTestRules({
      metric: 'speed',
      level: 'normal',
      customRules: [],
      boardTopSpeedKmh: 40,
      hasBatteryConfig: true,
    }),
  ).toEqual([
    {
      id: 'alert-test:preset:speed:0',
      controlId: 'speed',
      threshold: 28.8,
      thresholdMax: 36,
      soundType: 'preset:tick',
      repeatEverySeconds: null,
      beepCount: ALERT_BEEP_COUNT_DEFAULT,
    },
  ])
})

test('custom test rules exclude disabled rules and persistence fields', () => {
  const rules = buildAlertTestRules({
    metric: 'duty',
    level: 'custom',
    boardTopSpeedKmh: 40,
    hasBatteryConfig: true,
    customRules: [
      {
        id: 'enabled',
        controlId: 'duty',
        threshold: 70,
        thresholdMax: 90,
        soundType: 'preset:tick',
        enabled: true,
        createdAt: 1,
        repeatEverySeconds: null,
        beepCount: ALERT_BEEP_COUNT_DEFAULT,
      },
      {
        id: 'disabled',
        controlId: 'duty',
        threshold: 50,
        thresholdMax: null,
        soundType: 'preset:beep',
        enabled: false,
        createdAt: 2,
        repeatEverySeconds: null,
        beepCount: ALERT_BEEP_COUNT_DEFAULT,
      },
    ],
  })

  expect(rules).toEqual([
    {
      id: 'alert-test:custom:enabled',
      controlId: 'duty',
      threshold: 70,
      thresholdMax: 90,
      soundType: 'preset:tick',
      repeatEverySeconds: null,
      beepCount: ALERT_BEEP_COUNT_DEFAULT,
    },
  ])
})

test('manual rules coexist with preset rules in the test snapshot', () => {
  const rules = buildAlertTestRules({
    metric: 'speed',
    level: 'normal',
    boardTopSpeedKmh: 40,
    hasBatteryConfig: true,
    customRules: [
      {
        id: 'manual',
        controlId: 'speed',
        threshold: 38,
        thresholdMax: null,
        soundType: 'preset:beep',
        enabled: true,
        createdAt: 1,
        repeatEverySeconds: null,
        beepCount: ALERT_BEEP_COUNT_DEFAULT,
      },
    ],
  })

  expect(rules.map((rule) => rule.id)).toEqual([
    'alert-test:preset:speed:0',
    'alert-test:custom:manual',
  ])
})

test('off and blocked battery presets cannot start a test', () => {
  expect(
    buildAlertTestRules({
      metric: 'duty',
      level: 'off',
      customRules: [],
      boardTopSpeedKmh: 40,
      hasBatteryConfig: true,
    }),
  ).toEqual([])
  expect(
    buildAlertTestRules({
      metric: 'battery',
      level: 'normal',
      customRules: [],
      boardTopSpeedKmh: 40,
      hasBatteryConfig: false,
    }),
  ).toEqual([])
})

test('non-preset snapshots keep only enabled custom rules', () => {
  const rules = buildMetricAlertRuleSnapshot({
    metric: null,
    level: 'custom',
    boardTopSpeedKmh: 40,
    hasBatteryConfig: true,
    rules: [
      {
        id: 'enabled',
        controlId: 'motor-current',
        threshold: 120,
        thresholdMax: 180,
        soundType: 'preset:tick',
        enabled: true,
        createdAt: 1,
        repeatEverySeconds: null,
        beepCount: ALERT_BEEP_COUNT_DEFAULT,
      },
      {
        id: 'disabled',
        controlId: 'motor-current',
        threshold: 50,
        thresholdMax: null,
        soundType: 'preset:beep',
        enabled: false,
        createdAt: 2,
        repeatEverySeconds: null,
        beepCount: ALERT_BEEP_COUNT_DEFAULT,
      },
    ],
  })

  expect(rules.map((rule) => rule.id)).toEqual(['alert-test:custom:enabled'])
})

test('chart thresholds include range ceilings once in numeric order', () => {
  expect(
    getAlertThresholdValues([
      {
        id: 'range',
        controlId: 'duty',
        threshold: 80,
        thresholdMax: 90,
        soundType: 'preset:tick',
        repeatEverySeconds: null,
        beepCount: ALERT_BEEP_COUNT_DEFAULT,
      },
      {
        id: 'single',
        controlId: 'duty',
        threshold: 90,
        thresholdMax: null,
        soundType: 'preset:beep',
        repeatEverySeconds: null,
        beepCount: ALERT_BEEP_COUNT_DEFAULT,
      },
    ]),
  ).toEqual([80, 90])
})
