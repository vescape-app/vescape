import { expect, test } from 'bun:test'
import { moveWizardSubstep } from './wizardSubstep'

test('queued taps from one rendered screen advance only once, including the last transition', () => {
  let current = 3
  for (let tap = 0; tap < 3; tap++) current = moveWizardSubstep(current, 3, 1, 5)
  expect(current).toBe(4)
  expect(moveWizardSubstep(current, 4, 1, 5)).toBe(4)
  for (let tap = 0; tap < 3; tap++) current = moveWizardSubstep(current, 4, -1, 5)
  expect(current).toBe(3)
  expect(moveWizardSubstep(0, 0, -1, 5)).toBe(0)
})
