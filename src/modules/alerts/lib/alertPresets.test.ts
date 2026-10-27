import { expect, test } from 'bun:test'
import { describeAlertRules, formatAlertPresetSummary, alertPresetState } from './alertPresets'

test('stored spec reads as level and options', () => {
  expect(alertPresetState(undefined)).toEqual({
    level: 'normal',
    geiger: null,
    match: false,
  })
  expect(alertPresetState('preset(off):geiger=mid,match=on,future=1')).toEqual({
    level: 'off',
    geiger: 'mid',
    match: true,
  })
  expect(alertPresetState('preset(louder):geiger=loud')).toEqual({
    level: 'off',
    geiger: null,
    match: false,
  })
})

test('presentation describes only supplied native range and cadence snapshots', () => {
  const range = [{ threshold: 72, thresholdMax: 90, repeatEverySeconds: null }]
  expect(describeAlertRules('duty', range)).toBe(
    'Ticks like a Geiger counter from 72%, faster the deeper you go, solid tone at 90%.',
  )
  expect(formatAlertPresetSummary('duty', range)).toBe('72–90%')
  const points = [
    { threshold: 60, thresholdMax: null, repeatEverySeconds: null },
    { threshold: 70, thresholdMax: null, repeatEverySeconds: 10 },
  ]
  expect(describeAlertRules('controller-temp', points)).toBe(
    'Speaks the temperature at 60° and 70°. The last step repeats every 10 s while you stay above it.',
  )
  expect(formatAlertPresetSummary('controller-temp', points)).toBe('60°, 70°↻')
  expect(describeAlertRules('battery', [])).toBeNull()
  expect(formatAlertPresetSummary('battery', [])).toBeNull()
})

test('converted custom speed ranges retain decimal labels while whole-mph presets do not', () => {
  const custom = [{ threshold: 36.123, thresholdMax: 45.987, repeatEverySeconds: null }]
  const preset = [{ threshold: 35.405568, thresholdMax: 45.061632, repeatEverySeconds: null }]
  expect(formatAlertPresetSummary('speed', custom, 'mi')).toBe('22.4–28.6 mph')
  expect(formatAlertPresetSummary('speed', preset, 'mi')).toBe('22–28 mph')
  expect(custom[0].threshold).toBe(36.123)
  expect(custom[0].thresholdMax).toBe(45.987)
})
