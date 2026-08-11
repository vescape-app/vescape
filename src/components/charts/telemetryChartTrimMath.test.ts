import { expect, test } from 'bun:test'

import { moveTrimHandle, pickTrimHandle } from '@/components/charts/telemetryChartTrimMath'

test('selected range is split into equal left and right drag targets', () => {
  expect(pickTrimHandle(39, 20, 60)).toBe(0)
  expect(pickTrimHandle(40, 20, 60)).toBe(0)
  expect(pickTrimHandle(41, 20, 60)).toBe(1)
})

test('trim movement is relative to the grabbed handle instead of snapping to the touch', () => {
  expect(
    moveTrimHandle({
      handle: 0,
      originMs: 200,
      translationX: 10,
      chartWidth: 100,
      domainStartMs: 0,
      domainEndMs: 1_000,
      oppositeMs: 800,
    }),
  ).toBe(300)
})

test('trim handles stop at the chart edges and each other', () => {
  const shared = {
    chartWidth: 100,
    domainStartMs: 0,
    domainEndMs: 1_000,
  }
  expect(
    moveTrimHandle({
      ...shared,
      handle: 0,
      originMs: 200,
      translationX: -100,
      oppositeMs: 800,
    }),
  ).toBe(0)
  expect(
    moveTrimHandle({
      ...shared,
      handle: 1,
      originMs: 800,
      translationX: -100,
      oppositeMs: 200,
    }),
  ).toBe(200)
})
