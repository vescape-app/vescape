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
  expect(movementOptions('km').find((item) => item.value === 'frontBack')?.label).toBe(
    'Forward/back range · -10–10 km/h',
  )
  expect(movementOptions('mi').find((item) => item.value === 'frontBack')?.label).toBe(
    'Forward/back range · -6.2–6.2 mph',
  )
  expect(hillsOptions('mi').find((item) => item.value === 'large')?.label).toBe(
    'Large hills · 26.2 ft · 295.3 ft',
  )
  expect(hillsOptions('km').find((item) => item.value === 'pumptrack')?.label).toBe(
    'Pumptrack · 0.5 m · 5 m',
  )
  expect(JSON.stringify({ HILLS_PRESETS, MOVEMENT_RANGES })).toBe(canonical)
})

test('terrain controls preserve exact physical endpoints and untouched fractional drafts', () => {
  const draft = 2.3456789
  expect(lengthInputToMeters(lengthFromMeters(draft, 'mi'), draft, 'mi', 0, 50)).toBe(draft)
  expect(lengthInputToMeters(lengthFromMeters(50, 'mi'), draft, 'mi', 0, 50)).toBe(50)
  expect(lengthInputToMeters(lengthFromMeters(2, 'mi'), 20, 'mi', 2, 1000)).toBe(2)
  expect(lengthInputToMeters(0, draft, 'mi', 0, 50)).toBe(0)
  expect(lengthInputToMeters(5, 0, 'mi', 0, 50)).toBeCloseTo(1.524, 10)
})
