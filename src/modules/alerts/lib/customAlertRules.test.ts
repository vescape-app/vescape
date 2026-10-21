import { expect, test } from 'bun:test'
import type { AlertTestRule } from 'vescape-core'
import { materializePresetRules } from './customAlertRules'

const preview: AlertTestRule[] = [
  {
    id: 'preview:speed:0',
    controlId: 'speed',
    threshold: 35.405568,
    thresholdMax: 45.061632,
    soundType: 'preset:tick',
    repeatEverySeconds: null,
    beepCount: 2,
  },
]

test('customizing a native preview preserves every authored setting with fresh ownership', () => {
  const rules = materializePresetRules(preview, [])
  const other = materializePresetRules(preview, [])
  expect(rules[0]).toMatchObject({
    threshold: preview[0]!.threshold,
    thresholdMax: preview[0]!.thresholdMax,
    soundType: 'preset:tick',
    repeatEverySeconds: null,
    beepCount: 2,
    enabled: true,
  })
  expect(rules[0]!.id).not.toBe(preview[0]!.id)
  expect(rules[0]!.id).not.toBe(other[0]!.id)
  expect(rules[0]!.source).toBeUndefined()
  expect(preview[0]!.id).toBe('preview:speed:0')
})

test('customizing preserves authored IDs, disabled state and object identity', () => {
  const authored = materializePresetRules(preview, []).map((rule) => ({
    ...rule,
    id: 'manual',
    enabled: false,
  }))
  const customized = materializePresetRules(preview, authored)
  expect(customized).toHaveLength(2)
  expect(customized[0]).toBe(authored[0]!)
  expect(customized[0]).toMatchObject({ id: 'manual', enabled: false })
  expect(customized[1]!.id).not.toBe(preview[0]!.id)
})
