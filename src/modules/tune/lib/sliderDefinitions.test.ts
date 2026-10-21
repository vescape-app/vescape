import { expect, test } from 'bun:test'
import { groupsFromFieldValues } from './boardConfigPrefill'
import { tuneDisplayScale, tuneDisplayValue } from './fields'
import { BASIC_SLIDER_BY_ID, basicSliderChanges, fieldStep, snapValue } from './sliderDefinitions'

// Values from the Thor301 Main profile that the previous editors could not reproduce.
test('Thor301 values survive editor display, snapping and conversion back to raw values', () => {
  const values = { ki: 0.026, atr_speed_boost: 0.4, turntilt_erpm_boost: 200 }
  const fields = groupsFromFieldValues(values).flatMap((g) => g.fields)
  expect(fields).toHaveLength(3)
  for (const field of fields) {
    const scale = tuneDisplayScale(field.id)
    const displayed = tuneDisplayValue(field.id, field.value) as number
    expect(
      snapValue(displayed, field.min! * scale, field.max! * scale, fieldStep(field) * scale) /
        scale,
    ).toBeCloseTo(values[field.id as keyof typeof values], 8)
  }
  expect(tuneDisplayValue('atr_speed_boost', 0.4)).toBe(40)
  expect(tuneDisplayValue('atr_speed_boost', -0.4)).toBe(-40)
})

test('fractional editing remains available after setting a field to a whole number', () => {
  for (const [id, fractional] of [
    ['ki', 0.026],
    ['kp2', 0.9],
    ['atr_strength_up', 0.7],
  ] as const) {
    const field = groupsFromFieldValues({ [id]: fractional }).flatMap((g) => g.fields)[0]!
    expect(fieldStep({ ...field, value: 0 })).toBe(fieldStep(field))
    expect(
      snapValue(fractional, field.min!, field.max!, fieldStep({ ...field, value: 0 })),
    ).toBeCloseTo(fractional, 8)
  }
})

test('unchanged ATR intensity preserves asymmetric strengths; edits explicitly apply the formula', () => {
  const def = BASIC_SLIDER_BY_ID.get('atrIntensity')!
  const fields = { atr_strength_up: 0.7, atr_strength_down: 0.6 }
  const initial = def.deriveSliderValue(new Map(Object.entries(fields)))!
  expect(initial).toBe(5.25)
  expect({ ...fields, ...basicSliderChanges(def, initial, initial) }).toEqual(fields)
  expect(basicSliderChanges(def, initial, initial, { atr_strength_down: 0.5 })).toEqual({
    atr_strength_down: 0.5,
  })
  expect(basicSliderChanges(def, 6, initial)).toEqual({
    atr_strength_up: 0.8,
    atr_strength_down: 0.8,
  })
})

test('ATR thresholds retain half-degree steps after whole-number edits and use schema bounds', () => {
  const fields = groupsFromFieldValues({ atr_threshold_up: 2.5, atr_threshold_down: 1.5 }).flatMap(
    (group) => group.fields,
  )
  for (const field of fields) {
    expect([field.min, field.max, fieldStep(field)]).toEqual([0, 5, 0.5])
    const reopened = { ...field, value: 2 }
    expect(fieldStep(reopened)).toBe(0.5)
    expect(
      snapValue(field.value as number, reopened.min!, reopened.max!, fieldStep(reopened)),
    ).toBe(field.value as number)
    expect(snapValue(20, field.min!, field.max!, fieldStep(field))).toBe(5)
  }
})
