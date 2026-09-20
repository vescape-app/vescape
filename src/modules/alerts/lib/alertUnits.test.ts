import { expect, test } from 'bun:test'
import { speedFromKmh, speedInputToKmh, type UnitSystem } from '@/helpers/units'
import { stepDelta } from '@/helpers/numberStep'
import {
  getAlertDialConfig,
  getEditFormDefaults,
  getNewFormDefaults,
  renderPreviewTemplate,
} from './alertFormDefaults'
import {
  describeAlertPreset,
  formatAlertPresetSummary,
  generateAlertPresetRules,
  normalizeAlertPresetSelection,
} from './alertPresets'
import { materializePresetRules } from './customAlertRules'
import { buildAlertTestRules } from './alertTest'

const config = getAlertDialConfig('speed', null)

test('new imperial speed alerts initialize whole-mph thresholds in canonical km/h', () => {
  const defaults = getNewFormDefaults(
    config,
    'preset:beep',
    'preset:beep',
    'speed',
    null,
    'imperial',
  )
  expect(speedFromKmh(defaults.threshold, 'imperial')).toBeCloseTo(22)
  expect(speedFromKmh(defaults.thresholdMax, 'imperial')).toBeCloseTo(28)
  const metric = getNewFormDefaults(config, 'preset:beep', 'preset:beep', 'speed', null, 'metric')
  expect(metric.threshold).toBe(35)
  expect(metric.thresholdMax).toBe(45)
  const batteryConfig = getAlertDialConfig('battery', null)
  expect(
    getNewFormDefaults(batteryConfig, 'preset:beep', 'preset:beep', 'battery', null, 'imperial'),
  ).toEqual(
    getNewFormDefaults(batteryConfig, 'preset:beep', 'preset:beep', 'battery', null, 'metric'),
  )
})

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
  expect(renderPreviewTemplate('{value}', 18.5, 'km/h', config, 'speed', null, 'metric')).toBe('19')
  expect(renderPreviewTemplate('{value}', 36, 'km/h', config, 'speed', null, 'imperial')).toBe('22')
  const template = '{value} {unit} over {threshold} {unit}; literal km/h'
  expect(renderPreviewTemplate(template, 40, 'km/h', config, 'speed', null, 'imperial')).toBe(
    '25 mph over 25 mph; literal km/h',
  )
  expect(renderPreviewTemplate(template, 40.2336, 'km/h', config, 'speed', null, 'metric')).toBe(
    '40 km/h over 40 km/h; literal km/h',
  )
})

test('speed preset descriptions and wizard summaries follow selected units', () => {
  const options = { boardTopSpeedKmh: 40 }
  expect(describeAlertPreset('speed', 'normal', options, 'imperial')).toContain('mph')
  expect(formatAlertPresetSummary('speed', 'normal', options, 'imperial')).toContain('mph')
  expect(formatAlertPresetSummary('speed', 'normal', options, 'metric')).toContain('km/h')
})

test('imperial presets share whole-mph thresholds across generation, labels, and customization', () => {
  const options = { boardTopSpeedKmh: 50, speedUnitSystem: 'imperial' as const }
  const [rule] = generateAlertPresetRules('speed', 'normal', options)
  expect(speedFromKmh(rule!.threshold, 'imperial')).toBeCloseTo(22)
  expect(speedFromKmh(rule!.thresholdMax!, 'imperial')).toBeCloseTo(28)
  const [snapshot] = buildAlertTestRules({
    ...options,
    metric: 'speed',
    level: 'normal',
    customRules: [],
    hasBatteryConfig: false,
  })
  expect(snapshot!.threshold).toBe(rule!.threshold)
  expect(snapshot!.thresholdMax).toBe(rule!.thresholdMax)
  const [custom] = materializePresetRules('speed', 'normal', options)
  expect(custom!.threshold).toBe(rule!.threshold)
  expect(custom!.thresholdMax).toBe(rule!.thresholdMax)
  expect(describeAlertPreset('speed', 'normal', options, 'imperial')).toContain('22 mph')
  expect(describeAlertPreset('speed', 'normal', options, 'imperial')).toContain('28 mph')
  const restored = normalizeAlertPresetSelection({ speed: 'normal', speedUnitSystem: 'imperial' })
  expect(
    generateAlertPresetRules('speed', restored.speed, {
      ...options,
      speedUnitSystem: restored.speedUnitSystem,
    }),
  ).toEqual([rule])
})

test('low-speed imperial preset ranges remain nonempty, whole-mph, and within board top speed', () => {
  for (const boardTopSpeedKmh of [5, 6.3, 8, 10, 50, 150]) {
    for (const level of ['safe', 'normal', 'minimal'] as const) {
      const [rule] = generateAlertPresetRules('speed', level, {
        boardTopSpeedKmh,
        speedUnitSystem: 'imperial',
      })
      const start = speedFromKmh(rule!.threshold, 'imperial')
      const ceiling = speedFromKmh(rule!.thresholdMax!, 'imperial')
      expect(start).toBeCloseTo(Math.round(start))
      expect(ceiling).toBeCloseTo(Math.round(ceiling))
      expect(ceiling - start).toBeGreaterThanOrEqual(1 - 1e-9)
      expect(rule!.thresholdMax!).toBeLessThanOrEqual(boardTopSpeedKmh)
    }
  }
})
