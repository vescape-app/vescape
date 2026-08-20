import { describe, expect, test } from 'bun:test'

import {
  ALERT_PRESET_ACTIVE_LEVELS,
  ALERT_PRESET_GEIGER_SOUND_TYPE,
  ALERT_PRESET_LEVELS,
  generateAlertPresetRules,
  normalizeAlertPresetSelection,
  type AlertPresetMetric,
} from '@/modules/alerts/lib/alertPresets'

const ALL_METRICS: AlertPresetMetric[] = [
  'battery',
  'speed',
  'duty',
  'motor-temp',
  'controller-temp',
]

describe('ALERT_PRESET_LEVELS config', () => {
  test('declares safe/normal/minimal for every metric', () => {
    for (const metric of ALL_METRICS) {
      const config = ALERT_PRESET_LEVELS[metric]
      for (const level of ALERT_PRESET_ACTIVE_LEVELS) {
        expect(config.levels[level]).toBeDefined()
      }
    }
  })
})

describe('generateAlertPresetRules — off', () => {
  test('off yields no rules for any metric', () => {
    for (const metric of ALL_METRICS) {
      expect(
        generateAlertPresetRules(metric, 'off', {
          boardTopSpeedKmh: 50,
          hasBatteryConfig: true,
        }),
      ).toEqual([])
    }
  })
})

describe('generateAlertPresetRules — battery / temperature (discrete)', () => {
  test('battery emits single-threshold TTS rules in percent', () => {
    const rules = generateAlertPresetRules('battery', 'normal', { hasBatteryConfig: true })
    expect(rules.length).toBeGreaterThan(0)
    for (const rule of rules) {
      expect(rule.controlId).toBe('battery')
      expect(rule.thresholdMax).toBeNull()
      expect(rule.soundType).toContain('tts:')
      expect(rule.threshold).toBeGreaterThan(0)
      expect(rule.threshold).toBeLessThanOrEqual(100)
    }
  })

  test('discrete points grow in count and start earlier with protection', () => {
    // Battery direction is "below": earlier protection == a higher percentage.
    const safe = generateAlertPresetRules('battery', 'safe', { hasBatteryConfig: true })
    const normal = generateAlertPresetRules('battery', 'normal', { hasBatteryConfig: true })
    const minimal = generateAlertPresetRules('battery', 'minimal', { hasBatteryConfig: true })

    expect(safe.length).toBeGreaterThan(normal.length)
    expect(normal.length).toBeGreaterThan(minimal.length)

    const firstPoint = (rules: { threshold: number }[]) => rules[0].threshold
    expect(firstPoint(safe)).toBeGreaterThan(firstPoint(minimal))

    // Temperature direction is "above": earlier protection == a lower temperature.
    const safeTemp = generateAlertPresetRules('motor-temp', 'safe')
    const minimalTemp = generateAlertPresetRules('motor-temp', 'minimal')
    expect(safeTemp.length).toBeGreaterThan(minimalTemp.length)
    expect(safeTemp[0].threshold).toBeLessThan(minimalTemp[0].threshold)
  })

  test('battery with no valid config produces no rules', () => {
    expect(generateAlertPresetRules('battery', 'safe', { hasBatteryConfig: false })).toEqual([])
    expect(generateAlertPresetRules('battery', 'safe')).toEqual([])
  })

  test('temperature presets do not require a battery config', () => {
    expect(generateAlertPresetRules('motor-temp', 'normal').length).toBeGreaterThan(0)
    expect(generateAlertPresetRules('controller-temp', 'normal').length).toBeGreaterThan(0)
  })

  test('motor-temp and controller-temp generate independently with distinct sound types', () => {
    const motor = generateAlertPresetRules('motor-temp', 'normal')
    const controller = generateAlertPresetRules('controller-temp', 'normal')

    expect(motor.every((r) => r.controlId === 'motor-temp')).toBe(true)
    expect(controller.every((r) => r.controlId === 'controller-temp')).toBe(true)
    expect(motor[0].soundType).not.toBe(controller[0].soundType)
  })

  test('the two temperatures ride different ladders, each under its own throttle point', () => {
    const motor = generateAlertPresetRules('motor-temp', 'normal').map((r) => r.threshold)
    const controller = generateAlertPresetRules('controller-temp', 'normal').map((r) => r.threshold)

    expect(motor).not.toEqual(controller)
    // Stock VESC throttling starts at 100°C motor / 85°C controller. Announcing above that means
    // telling the rider about a decision the board already made.
    expect(Math.max(...motor)).toBeLessThanOrEqual(100)
    expect(Math.max(...controller)).toBeLessThanOrEqual(85)
  })

  test('every temperature level ends in exactly one repeating rung', () => {
    for (const metric of ['motor-temp', 'controller-temp'] as const) {
      for (const level of ALERT_PRESET_ACTIVE_LEVELS) {
        const rules = generateAlertPresetRules(metric, level)
        const repeating = rules.filter((r) => r.repeatEverySeconds != null)

        expect(repeating).toHaveLength(1)
        // The nag is the top of the ladder — nothing announces above it.
        expect(repeating[0].threshold).toBe(Math.max(...rules.map((r) => r.threshold)))
      }
    }
  })

  test('battery points announce once — a low battery does not become a nag', () => {
    const rules = generateAlertPresetRules('battery', 'safe', { hasBatteryConfig: true })

    expect(rules.length).toBeGreaterThan(0)
    expect(rules.every((r) => r.repeatEverySeconds == null)).toBe(true)
  })
})

describe('generateAlertPresetRules — speed / duty (geiger)', () => {
  test('duty emits a single fixed-ceiling range whose start drops with protection', () => {
    const safe = generateAlertPresetRules('duty', 'safe')
    const normal = generateAlertPresetRules('duty', 'normal')
    const minimal = generateAlertPresetRules('duty', 'minimal')

    for (const rules of [safe, normal, minimal]) {
      expect(rules).toHaveLength(1)
      expect(rules[0].thresholdMax).not.toBeNull()
      expect(rules[0].soundType).toBe(ALERT_PRESET_GEIGER_SOUND_TYPE)
    }

    // Fixed ceiling across levels; start drops as protection increases.
    expect(safe[0].thresholdMax).toBe(normal[0].thresholdMax)
    expect(normal[0].thresholdMax).toBe(minimal[0].thresholdMax)
    expect(safe[0].threshold).toBeLessThan(normal[0].threshold)
    expect(normal[0].threshold).toBeLessThan(minimal[0].threshold)
  })

  test('speed thresholds resolve as a percentage of Board Top Speed', () => {
    const at50 = generateAlertPresetRules('speed', 'normal', { boardTopSpeedKmh: 50 })
    const at100 = generateAlertPresetRules('speed', 'normal', { boardTopSpeedKmh: 100 })

    expect(at50).toHaveLength(1)
    expect(at100).toHaveLength(1)
    // Doubling top speed doubles the resolved thresholds.
    expect(at100[0].threshold).toBe(at50[0].threshold * 2)
    expect(at100[0].thresholdMax).toBe((at50[0].thresholdMax ?? 0) * 2)
    expect(at50[0].thresholdMax).toBeGreaterThan(at50[0].threshold)
  })

  test('speed levels stay distinct at the lowest Board Top Speed', () => {
    // Regression: whole-km/h rounding collapsed adjacent levels at low top speed
    // (0.72×5 and 0.82×5 both rounded to 4) and pushed the ceiling to 100%.
    const topSpeed = 5 // clamp floor
    const safe = generateAlertPresetRules('speed', 'safe', { boardTopSpeedKmh: topSpeed })
    const normal = generateAlertPresetRules('speed', 'normal', { boardTopSpeedKmh: topSpeed })
    const minimal = generateAlertPresetRules('speed', 'minimal', { boardTopSpeedKmh: topSpeed })

    expect(safe[0].threshold).toBeLessThan(normal[0].threshold)
    expect(normal[0].threshold).toBeLessThan(minimal[0].threshold)
    // Ceiling stays at the configured 90% fraction, not rounded up to 100%.
    expect(normal[0].thresholdMax).toBe(4.5)
    expect(minimal[0].threshold).toBeLessThan(normal[0].thresholdMax ?? 0)
  })

  test('speed with missing or zero top speed produces no rules', () => {
    expect(generateAlertPresetRules('speed', 'normal')).toEqual([])
    expect(generateAlertPresetRules('speed', 'normal', { boardTopSpeedKmh: 0 })).toEqual([])
    expect(generateAlertPresetRules('speed', 'normal', { boardTopSpeedKmh: null })).toEqual([])
    expect(generateAlertPresetRules('speed', 'normal', { boardTopSpeedKmh: NaN })).toEqual([])
  })
})

test('custom generates nothing — the rider owns the metric rules', () => {
  for (const metric of ALL_METRICS) {
    expect(
      generateAlertPresetRules(metric, 'custom', {
        boardTopSpeedKmh: 40,
        hasBatteryConfig: true,
      }),
    ).toEqual([])
  }
})

test('custom survives a selection round-trip', () => {
  expect(normalizeAlertPresetSelection({ battery: 'custom', speed: 'nonsense' })).toMatchObject({
    battery: 'custom',
    speed: 'off',
  })
})

test('matched duty persists offsets while preview resolves fraction to percentage points', () => {
  const rules = generateAlertPresetRules('duty', 'safe', {
    matchDutyBoardConfig: true,
    tiltbackDuty: 0.82,
  })
  expect(rules[0]).toMatchObject({
    threshold: 67,
    thresholdMax: 82,
    thresholdRule: {
      kind: 'config-relative',
      fieldId: 'tiltback_duty',
      thresholdOffset: -15,
      thresholdMaxOffset: 0,
    },
  })
  expect(
    generateAlertPresetRules('duty', 'normal', { matchDutyBoardConfig: true, tiltbackDuty: 1 })[0],
  ).toMatchObject({ threshold: 0, thresholdMax: null })
})
