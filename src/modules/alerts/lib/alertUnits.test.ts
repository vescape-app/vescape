import { expect, test } from 'bun:test'
import { speedFromKmh, speedInputToKmh, type DistanceUnit } from '@/helpers/units'
import { stepDelta } from '@/helpers/numberStep'
import {
  getAlertDialConfig,
  getEditFormDefaults,
  getNewFormDefaults,
  renderPreviewTemplate,
} from './alertFormDefaults'
import { describeAlertRules, formatAlertPresetSummary } from './alertPresets'

const config = getAlertDialConfig('speed', null)

test('new mi speed alerts initialize whole-mph thresholds in canonical km/h', () => {
  const defaults = getNewFormDefaults(config, 'preset:beep', 'preset:beep', 'speed', null, 'mi')
  expect(speedFromKmh(defaults.threshold, 'mi')).toBeCloseTo(22)
  expect(speedFromKmh(defaults.thresholdMax, 'mi')).toBeCloseTo(28)
  const metric = getNewFormDefaults(config, 'preset:beep', 'preset:beep', 'speed', null, 'km')
  expect(metric.threshold).toBe(35)
  expect(metric.thresholdMax).toBe(45)
  const batteryConfig = getAlertDialConfig('battery', null)
  expect(
    getNewFormDefaults(batteryConfig, 'preset:beep', 'preset:beep', 'battery', null, 'mi'),
  ).toEqual(getNewFormDefaults(batteryConfig, 'preset:beep', 'preset:beep', 'battery', null, 'km'))
})

test('Board Top Speed snaps in either direction and clamps canonical physical bounds', () => {
  const edit = (kmh: number, direction: 1 | -1) => {
    const display = speedFromKmh(kmh, 'mi')
    return speedInputToKmh(
      display + direction * stepDelta(display, direction, 5),
      kmh,
      'mi',
      5,
      150,
    )
  }
  expect(edit(40, 1)).toBeCloseTo(40.2336, 10)
  expect(edit(40, -1)).toBeCloseTo(32.18688, 10)
  expect(edit(40.2336, 1)).toBeCloseTo(48.28032, 10)
  expect(edit(40.2336, -1)).toBeCloseTo(32.18688, 10)
  expect(edit(5, -1)).toBe(5)
  expect(edit(150, 1)).toBe(150)
})

test('open form retains exact range endpoints through live unit switches and unrelated edits', () => {
  const rule = {
    id: 'manual-speed',
    controlId: 'speed',
    enabled: true,
    createdAt: 0,
    spec: 'preset:tick',
    repeatEverySeconds: null,
    threshold: 40.2336,
    thresholdMax: 50.123456789,
  }
  let draft = getEditFormDefaults(rule, config, null)
  for (const distanceUnit of ['mi', 'km', 'mi', 'km'] as DistanceUnit[]) {
    const displayed = speedFromKmh(draft.threshold, distanceUnit)
    const displayedMax = speedFromKmh(draft.thresholdMax, distanceUnit)
    expect(speedInputToKmh(displayed, draft.threshold, distanceUnit)).toBe(rule.threshold)
    expect(speedInputToKmh(displayedMax, draft.thresholdMax, distanceUnit)).toBe(rule.thresholdMax)
    draft = {
      ...draft,
      spec: 'preset:tick',
      repeatEverySeconds: 12,
      messageTemplate: 'literal mph',
    }
  }
  expect(draft.threshold).toBe(rule.threshold)
  expect(draft.thresholdMax).toBe(rule.thresholdMax)
  expect(getEditFormDefaults(rule, config, null).threshold).toBe(rule.threshold)
})

test('speed speech previews convert all placeholders, leave literal unit names alone', () => {
  expect(renderPreviewTemplate('{value}', 18.5, 'km/h', config, 'speed', null, 'km')).toBe('19')
  expect(renderPreviewTemplate('{value}', 36, 'km/h', config, 'speed', null, 'mi')).toBe('22')
  const template = '{value} {unit} over {threshold} {unit}; literal km/h'
  expect(renderPreviewTemplate(template, 40, 'km/h', config, 'speed', null, 'mi')).toBe(
    '25 mph over 25 mph; literal km/h',
  )
  expect(renderPreviewTemplate(template, 40.2336, 'km/h', config, 'speed', null, 'km')).toBe(
    '40 km/h over 40 km/h; literal km/h',
  )
})

test('native snapshot descriptions and wizard summaries follow display units', () => {
  const rules = [{ threshold: 35.405568, thresholdMax: 45.061632, repeatEverySeconds: null }]
  expect(describeAlertRules('speed', rules, 'mi')).toContain('22 mph')
  expect(describeAlertRules('speed', rules, 'mi')).toContain('28 mph')
  expect(formatAlertPresetSummary('speed', rules, 'mi')).toBe('22–28 mph')
  expect(formatAlertPresetSummary('speed', rules, 'km')).toBe('35.4–45.1 km/h')
})
