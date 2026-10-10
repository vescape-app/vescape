import { describe, expect, test } from 'bun:test'

import { historyBottomGradientStart } from '@/screens/main/map/mapVignetteGeometry'

describe('historyBottomGradientStart', () => {
  test('uses the one-chart panel height until layout is measured', () => {
    expect(historyBottomGradientStart(0, 800)).toBeCloseTo(0.45125)
  })

  test('starts the gradient above the measured history panel', () => {
    expect(historyBottomGradientStart(160, 800)).toBe(0.52)
  })
})
