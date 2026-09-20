import { expect, test } from 'bun:test'
import {
  describeAlertRules,
  formatAlertPresetSummary,
  normalizeAlertPresetSelection,
} from './alertPresets'

test('saved selection preserves custom ownership and unit choice while rejecting garbage levels', () => {
  expect(
    normalizeAlertPresetSelection({
      battery: 'custom',
      speed: 'nonsense',
      speedUnitSystem: 'imperial',
    }),
  ).toMatchObject({ battery: 'custom', speed: 'off', speedUnitSystem: 'imperial' })
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
