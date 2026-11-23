import { expect, test } from 'bun:test'
import { APP_TUNE_GROUPS, tuneWireLimit } from './fields'

test('every tune field range fits what the Refloat wire encoding can store', () => {
  for (const field of APP_TUNE_GROUPS.flatMap((group) => group.fields)) {
    const limit = tuneWireLimit(field.id)
    expect(limit).not.toBeNull()
    expect(field.min).toBeGreaterThanOrEqual(limit!.min)
    expect(field.max).toBeLessThanOrEqual(limit!.max)
  }
})

test('wire limits follow the field encoding', () => {
  expect(tuneWireLimit('ki')).toEqual({ min: -0.32768, max: 0.32767 })
  expect(tuneWireLimit('tiltback_variable_erpm')).toEqual({ min: 0, max: 65535 })
  expect(tuneWireLimit('turntilt_yaw_aggregate')).toEqual({ min: 0, max: 255 })
})
