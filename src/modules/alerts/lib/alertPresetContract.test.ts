import { expect, test } from 'bun:test'
import type { BatteryConfig } from 'vescape-core'
import fixture from '@/../modules/vescape-core/shared/alert-preset-contract.json'
import { deriveBatteryConfig } from '@/modules/battery/lib'
import {
  generateAlertPresetRules,
  type AlertPresetMetric,
  type AlertPresetLevel,
} from './alertPresets'
import type { UnitSystem } from '@/helpers/units'

interface PresetCase {
  name: string
  metric: AlertPresetMetric
  level: AlertPresetLevel
  topSpeedKmh?: number
  speedUnitSystem?: UnitSystem
  batteryConfig?: BatteryConfig
  matchBoardConfig?: boolean
  refloat?: Record<string, number>
  motor?: Record<string, number>
  expected: {
    threshold: number
    thresholdMax: number | null
    repeatEverySeconds?: number
    fieldId?: string
    thresholdOffset?: number
    thresholdMaxOffset?: number | null
  }[]
}

// This same fixture is executed by the production Room and GRDB generators.
for (const item of fixture.cases as PresetCase[]) {
  test(`native preset contract: ${item.name}`, () => {
    const rules = generateAlertPresetRules(item.metric, item.level, {
      boardTopSpeedKmh: item.topSpeedKmh ?? 50,
      speedUnitSystem: item.speedUnitSystem,
      hasBatteryConfig: deriveBatteryConfig(item.batteryConfig).warning == null,
      matchBoardConfig: { [item.metric]: item.matchBoardConfig === true },
      configBases: { refloat: item.refloat, motor: item.motor },
    })
    expect(rules).toHaveLength(item.expected.length)
    for (const [index, expected] of item.expected.entries()) {
      const rule = rules[index]!
      expect(rule.threshold).toBeCloseTo(expected.threshold, 8)
      if (expected.thresholdMax == null) expect(rule.thresholdMax).toBeNull()
      else expect(rule.thresholdMax).toBeCloseTo(expected.thresholdMax, 8)
      expect(rule.repeatEverySeconds).toBe(expected.repeatEverySeconds ?? null)
      expect(rule.beepCount).toBe(3)
      if (expected.fieldId) {
        expect(rule.thresholdRule).toEqual({
          kind: 'config-relative',
          fieldId: expected.fieldId,
          thresholdOffset: expected.thresholdOffset!,
          thresholdMaxOffset: expected.thresholdMaxOffset ?? null,
        })
      } else expect(rule.thresholdRule).toBeUndefined()
    }
  })
}
