import { afterEach, expect, spyOn, test } from 'bun:test'
import * as core from 'vescape-core'
import type { AlertTestRule } from 'vescape-core'
import { draftAlertPreview } from './draftAlertPreview'
import type { DraftAlertRule } from './customAlertRules'

const nativeSnapshot: AlertTestRule[] = [
  {
    id: 'native-preview',
    controlId: 'speed',
    threshold: 12.345,
    thresholdMax: 45.678,
    soundType: 'preset:gamma',
    repeatEverySeconds: null,
    beepCount: 3,
  },
]
const options = { topSpeedKmh: 50, hasBatteryConfig: true, speedUnitSystem: 'imperial' as const }
const manual: DraftAlertRule = { ...nativeSnapshot[0]!, id: 'manual', enabled: true, createdAt: 1 }
let restore = () => {}
afterEach(() => restore())

function stubPreview() {
  const spy = spyOn(core, 'previewAlertPreset').mockReturnValue(nativeSnapshot)
  restore = () => spy.mockRestore()
  return spy
}

test('draft preview forwards native options and preserves returned thresholds without JS generation', () => {
  const spy = stubPreview()
  const result = draftAlertPreview('speed', 'normal', options, [
    manual,
    { ...manual, id: 'muted', enabled: false },
  ])
  expect(spy).toHaveBeenCalledWith('speed', 'normal', options)
  expect(result.error).toBeNull()
  expect(result.presetRules).toEqual(nativeSnapshot)
  expect(result.rules).toHaveLength(2)
  expect(result.rules[0]).toEqual(nativeSnapshot[0]!)
  expect(result.rules[1]).toMatchObject({
    id: 'alert-test:custom:manual',
    threshold: 12.345,
    thresholdMax: 45.678,
  })
})

test('custom and off drafts retain manual rules without requesting generated rules', () => {
  const spy = stubPreview()
  for (const level of ['custom', 'off'] as const) {
    expect(draftAlertPreview('speed', level, options, [manual]).rules).toHaveLength(1)
  }
  expect(spy).not.toHaveBeenCalled()
})

test('native preview failure becomes a visible error without inventing thresholds', () => {
  stubPreview().mockImplementation(() => {
    throw new Error('Preview unavailable')
  })
  expect(draftAlertPreview('speed', 'normal', options)).toEqual({
    rules: [],
    presetRules: [],
    error: 'Preview unavailable',
  })
})
