import { expect, test } from 'bun:test'

import { resolveRampGradient } from '@/components/charts/line/colorRamp'

const RANGE = { min: 0, max: 100 }

function ascending(positions: number[]): boolean {
  return positions.every((value, index) => index === 0 || value >= positions[index - 1])
}

test('stops are emitted top-down whatever order they were given in', () => {
  const gradient = resolveRampGradient(
    {
      stops: [
        { value: 0, color: 'blue' },
        { value: 100, color: 'red' },
      ],
    },
    RANGE,
    100,
  )!
  expect(gradient.colors[0]).toBe('red')
  expect(gradient.colors.at(-1)).toBe('blue')
  expect(ascending(gradient.positions)).toBe(true)
})

test('bands repeat each colour at the boundary so the step stays hard', () => {
  const gradient = resolveRampGradient(
    {
      mode: 'bands',
      stops: [
        { value: 0, color: 'grey' },
        { value: 50, color: 'amber' },
      ],
    },
    RANGE,
    100,
  )!
  const boundary = gradient.positions.indexOf(gradient.positions[1])
  expect(gradient.positions[boundary]).toBe(gradient.positions[boundary + 1])
  expect(gradient.colors[boundary]).toBe('amber')
  expect(gradient.colors[boundary + 1]).toBe('grey')
})

test('a stop beyond the range clamps instead of folding back', () => {
  const gradient = resolveRampGradient(
    {
      stops: [
        { value: -50, color: 'blue' },
        { value: 500, color: 'red' },
      ],
    },
    RANGE,
    100,
  )!
  expect(ascending(gradient.positions)).toBe(true)
  expect(gradient.positions[0]).toBe(0)
  expect(gradient.positions.at(-1)).toBe(1)
})

test('the first and last colours run to the edges of the plot', () => {
  const gradient = resolveRampGradient(
    {
      stops: [
        { value: 40, color: 'blue' },
        { value: 60, color: 'red' },
      ],
    },
    RANGE,
    100,
  )!
  expect(gradient.colors[0]).toBe('red')
  expect(gradient.positions[0]).toBe(0)
  expect(gradient.colors.at(-1)).toBe('blue')
  expect(gradient.positions.at(-1)).toBe(1)
})

test('a single stop is a solid colour', () => {
  const gradient = resolveRampGradient({ stops: [{ value: 10, color: 'red' }] }, RANGE, 100)!
  expect(gradient.colors).toEqual(['red', 'red'])
})

test('nothing to resolve without stops or height', () => {
  expect(resolveRampGradient({ stops: [] }, RANGE, 100)).toBeNull()
  expect(resolveRampGradient({ stops: [{ value: 1, color: 'red' }] }, RANGE, 0)).toBeNull()
})
