import { expect, test } from 'bun:test'
import { stepDelta } from './numberStep'

test('converted values snap in each direction, then advance from clean boundaries', () => {
  expect(24.9 + stepDelta(24.9, 1, 5)).toBe(25)
  expect(24.9 - stepDelta(24.9, -1, 5)).toBe(20)
  expect(25 + stepDelta(25, 1, 5)).toBe(30)
  expect(25 - stepDelta(25, -1, 5)).toBe(20)
  expect(24.999999999999996 + stepDelta(24.999999999999996, 1, 5)).toBe(30)
  expect(25.000000000000004 - stepDelta(25.000000000000004, -1, 5)).toBe(20)
  expect(1.8641135767120018 + stepDelta(1.8641135767120018, 1)).toBe(2)
  expect(1.8641135767120018 - stepDelta(1.8641135767120018, -1)).toBe(1)
})
