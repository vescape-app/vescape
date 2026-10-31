import { expect, test } from 'bun:test'
import { navigationFrameDecision } from './navigationPathFraming'

const explicit = { revision: 1, automatic: false }
const framed = { revision: 1, projected: true }

test('automatic replacements leave an open map camera alone, including delayed progress', () => {
  const automatic = { revision: 2, automatic: true }
  const replaced = navigationFrameDecision(framed, automatic, false)
  expect(replaced.frame).toBe(false)
  expect(navigationFrameDecision(replaced.state, automatic, true).frame).toBe(false)
})

test('map entry frames even an automatic replacement', () => {
  expect(navigationFrameDecision(null, { revision: 2, automatic: true }, true).frame).toBe(true)
})

test('explicit replacements frame, the same revision does not', () => {
  expect(navigationFrameDecision(framed, { revision: 2, automatic: false }, true).frame).toBe(true)
  expect(navigationFrameDecision(framed, explicit, true).frame).toBe(false)
})

test('first projection refines the initial frame once without following every fix', () => {
  const initial = navigationFrameDecision(null, explicit, false)
  const located = navigationFrameDecision(initial.state, explicit, true)
  expect(located.frame).toBe(true)
  expect(navigationFrameDecision(located.state, explicit, true).frame).toBe(false)
})
