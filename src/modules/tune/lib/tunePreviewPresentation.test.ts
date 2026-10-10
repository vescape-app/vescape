import { expect, test } from 'bun:test'
import { lengthFromMeters, lengthInputToMeters } from '@/helpers/units'
import {
  hillsOptions,
  movementOptions,
  HILLS_PRESETS,
  MOVEMENT_RANGES,
} from './tunePreviewPresentation'

test('preview option labels convert signed travel units without mutating canonical presets', () => {
  const canonical = JSON.stringify({ HILLS_PRESETS, MOVEMENT_RANGES })
  expect(movementOptions('metric').find((item) => item.value === 'frontBack')?.label).toBe(
    'Forward/back range · -10–10 km/h',
  )
  expect(movementOptions('imperial').find((item) => item.value === 'frontBack')?.label).toBe(
    'Forward/back range · -6.2–6.2 mph',
  )
  expect(hillsOptions('imperial').find((item) => item.value === 'large')?.label).toBe(
    'Large hills · 26.2 ft · 295.3 ft',
  )
  expect(hillsOptions('metric').find((item) => item.value === 'pumptrack')?.label).toBe(
    'Pumptrack · 0.5 m · 5 m',
  )
  expect(JSON.stringify({ HILLS_PRESETS, MOVEMENT_RANGES })).toBe(canonical)
})

test('terrain controls preserve exact physical endpoints and untouched fractional drafts', () => {
  const draft = 2.3456789
  expect(lengthInputToMeters(lengthFromMeters(draft, 'imperial'), draft, 'imperial', 0, 50)).toBe(
    draft,
  )
  expect(lengthInputToMeters(lengthFromMeters(50, 'imperial'), draft, 'imperial', 0, 50)).toBe(50)
  expect(lengthInputToMeters(lengthFromMeters(2, 'imperial'), 20, 'imperial', 2, 1000)).toBe(2)
  expect(lengthInputToMeters(0, draft, 'imperial', 0, 50)).toBe(0)
  expect(lengthInputToMeters(5, 0, 'imperial', 0, 50)).toBeCloseTo(1.524, 10)
})
