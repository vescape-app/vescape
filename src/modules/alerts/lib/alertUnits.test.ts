import { expect, test } from 'bun:test'
import { speedFromKmh, speedInputToKmh, type UnitSystem } from '@/helpers/units'
import { stepDelta } from '@/helpers/numberStep'
import { getAlertDialConfig, getEditFormDefaults, renderPreviewTemplate } from './alertFormDefaults'
import { describeAlertPreset, formatAlertPresetSummary } from './alertPresets'
import { materializePresetRules } from './customAlertRules'

const config = getAlertDialConfig('speed', null)

test('Board Top Speed snaps in either direction and clamps canonical physical bounds', () => {
  const edit = (kmh: number, direction: 1 | -1) => {
    const display = speedFromKmh(kmh, 'imperial')
    return speedInputToKmh(
      display + direction * stepDelta(display, direction, 5),
      kmh,
      'imperial',
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
    ...materializePresetRules('speed', 'normal', { boardTopSpeedKmh: 40 })[0]!,
    threshold: 40.2336,
    thresholdMax: 50.123456789,
  }
  let draft = getEditFormDefaults(rule, config, null)
  for (const units of ['imperial', 'metric', 'imperial', 'metric'] as UnitSystem[]) {
    const displayed = speedFromKmh(draft.threshold, units)
    const displayedMax = speedFromKmh(draft.thresholdMax, units)
    expect(speedInputToKmh(displayed, draft.threshold, units)).toBe(rule.threshold)
    expect(speedInputToKmh(displayedMax, draft.thresholdMax, units)).toBe(rule.thresholdMax)
    draft = {
      ...draft,
      soundType: 'preset:tick',
      repeatEverySeconds: 12,
      messageTemplate: 'literal mph',
    }
  }
  expect(draft.threshold).toBe(rule.threshold)
  expect(draft.thresholdMax).toBe(rule.thresholdMax)
  expect(getEditFormDefaults(rule, config, null).threshold).toBe(rule.threshold)
})

test('speed speech previews convert all placeholders, leave literal unit names alone', () => {
  const template = '{value} {unit} over {threshold} {unit}; literal km/h'
  expect(renderPreviewTemplate(template, 40, 'km/h', config, 'speed', null, 'imperial')).toBe(
    '24.9 mph over 24.9 mph; literal km/h',
  )
  expect(renderPreviewTemplate(template, 40.2336, 'km/h', config, 'speed', null, 'metric')).toBe(
    '40.2 km/h over 40.2 km/h; literal km/h',
  )
})

test('speed preset descriptions and wizard summaries follow selected units', () => {
  const options = { boardTopSpeedKmh: 40 }
  expect(describeAlertPreset('speed', 'normal', options, 'imperial')).toContain('mph')
  expect(formatAlertPresetSummary('speed', 'normal', options, 'imperial')).toContain('mph')
  expect(formatAlertPresetSummary('speed', 'normal', options, 'metric')).toContain('km/h')
})
