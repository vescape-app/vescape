import type { BoardConfigBases } from '@/modules/alerts/lib/configRelativeFields'
import { expect, test } from 'bun:test'
import type { AlertRule } from 'vescape-core'
import { resolvedAlertRules } from '@/modules/alerts/lib/resolvedAlertRules'
import { toTestRule, getAlertThresholdValues } from '@/modules/alerts/lib/alertTest'
import { describeAlertRules } from '@/modules/alerts/lib/alertPresets'

const saved: AlertRule = {
  id: 'preset:duty:0',
  boardId: 'board',
  controlId: 'duty',
  enabled: true,
  threshold: 50,
  thresholdMax: 60,
  soundType: 'preset:tick',
  source: 'preset',
  repeatEverySeconds: null,
  beepCount: 1,
  createdAt: 0,
}
const matched: AlertRule = {
  ...saved,
  thresholdRule: {
    kind: 'config-relative',
    fieldId: 'tiltback_duty',
    thresholdOffset: -10,
    thresholdMaxOffset: 0,
  },
}

test('saved thresholds drive markers, description and preview without reconstructing a preset', () => {
  const rules = resolvedAlertRules([saved, { ...saved, id: 'disabled', enabled: false }], {})
  const snapshot = rules.map(toTestRule)
  expect(getAlertThresholdValues(snapshot)).toEqual([50, 60])
  expect(snapshot[0]).toMatchObject({ threshold: 50, thresholdMax: 60, soundType: 'preset:tick' })
  expect(describeAlertRules('duty', snapshot)).toContain('from 50%')
  expect(describeAlertRules('duty', snapshot)).toContain('at 60%')
  expect(resolvedAlertRules([], {})).toEqual([])
})

test('saved config-relative rules follow current config without writing cached threshold columns', () => {
  const rules = resolvedAlertRules([matched], { refloat: { tiltback_duty: 0.9 } })
  expect(getAlertThresholdValues(rules.map(toTestRule))).toEqual([80, 90])
  expect(resolvedAlertRules([matched], { refloat: { tiltback_duty: 0.8 } })[0]).toMatchObject({
    threshold: 70,
    thresholdMax: 80,
  })
  expect(matched.threshold).toBe(50)
})

test('unread, missing and disabled config-relative rules remain dormant', () => {
  const configurations: BoardConfigBases[] = [
    {},
    { refloat: {} },
    { refloat: { tiltback_duty: 0 } },
    { refloat: { tiltback_duty: 1 } },
  ]
  for (const bases of configurations) {
    expect(resolvedAlertRules([matched], bases)).toEqual([])
  }
})

test('a saved relative point keeps its cadence and has no range ceiling', () => {
  const point: AlertRule = {
    ...matched,
    controlId: 'motor-temp',
    repeatEverySeconds: 5,
    thresholdRule: {
      kind: 'config-relative',
      fieldId: 'l_temp_motor_start',
      thresholdOffset: -5,
      thresholdMaxOffset: null,
    },
  }
  expect(
    resolvedAlertRules([point], { motor: { l_temp_motor_start: 80 } }).map(toTestRule)[0],
  ).toMatchObject({ threshold: 75, thresholdMax: null, repeatEverySeconds: 5 })
})
