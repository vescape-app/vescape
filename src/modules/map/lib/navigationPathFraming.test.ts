import { expect, test } from 'bun:test'
import { navigationFrameDecision } from './navigationPathFraming'

const previous = { computedAtMs: 1, cameraRevision: 1, projected: true }

test('automatic replacements leave the current camera alone, including delayed progress', () => {
  const automatic = { computedAtMs: 2, cameraRevision: 1 }
  const replaced = navigationFrameDecision(previous, automatic, false)
  expect(replaced.frame).toBe(false)
  expect(navigationFrameDecision(replaced.state, automatic, true).frame).toBe(false)
})

test('map entry and explicit recomputation still frame the remaining path', () => {
  expect(navigationFrameDecision(null, previous, true).frame).toBe(true)
  expect(
    navigationFrameDecision(previous, { computedAtMs: 2, cameraRevision: 2 }, true).frame,
  ).toBe(true)
  expect(navigationFrameDecision(previous, previous, true).frame).toBe(false)
})

test('first projection refines the initial frame once without following every fix', () => {
  const initial = navigationFrameDecision(null, previous, false)
  const located = navigationFrameDecision(initial.state, previous, true)
  expect(located.frame).toBe(true)
  expect(navigationFrameDecision(located.state, previous, true).frame).toBe(false)
})
