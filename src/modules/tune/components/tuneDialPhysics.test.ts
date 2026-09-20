import { tuneDialStepValue } from './tuneDialPhysics'
import { describe, expect, test } from 'bun:test'

import {
  advanceTuneDialThrow,
  computeHapticStepSpacing,
  computeTuneDialLayout,
  isTuneDialEdgeStep,
  resolveTuneDialThrowTargetOffset,
  resolveTuneDialThrowVelocity,
  shouldApplyExternalTuneDialValue,
  shouldPlayTuneDialHaptic,
} from '@/modules/tune/components/tuneDialPhysics'

const ranges = {
  small: { min: 0, max: 10, step: 0.5 },
  medium: { min: 0, max: 100, step: 1 },
  large: { min: -50, max: 50, step: 5 },
} as const

function layoutFor(name: keyof typeof ranges) {
  const range = ranges[name]
  return computeTuneDialLayout(range.min, range.max, range.step)
}

describe('TuneDial physics', () => {
  test('dense hundred-division ranges use a longer strip', () => {
    expect(layoutFor('small').totalWidth).toBe(700)
    expect(layoutFor('medium').totalWidth).toBe(1400)
    expect(layoutFor('large').totalWidth).toBe(700)
    expect(computeTuneDialLayout(0, 50, 0.5).totalWidth).toBe(1400)
  })

  test('short integer tune ranges label every step and render midpoint ticks', () => {
    const layout = computeTuneDialLayout(-5, 5, 1)

    expect(layout.stepPx).toBe(70)
    expect(layout.labelEveryStep).toBe(true)
    expect(layout.renderMidpointTicks).toBe(true)
  })

  test('denser ranges do not label every selectable step', () => {
    const layout = computeTuneDialLayout(0, 10, 0.5)

    expect(layout.stepPx).toBe(35)
    expect(layout.labelEveryStep).toBe(false)
    expect(layout.renderMidpointTicks).toBe(false)
  })

  test('huge ERPM ranges use sparse rendered ticks', () => {
    const layout = computeTuneDialLayout(0, 100000, 10)

    expect(Math.ceil(layout.totalSteps / layout.majorEvery)).toBeLessThanOrEqual(41)
    expect(Math.ceil(layout.totalSteps / layout.minorEvery)).toBeLessThanOrEqual(180)
    expect(layout.labelEveryStep).toBe(false)
  })

  test('haptic cadence follows every selectable value', () => {
    expect(computeHapticStepSpacing()).toBe(1)
  })

  test('haptics fire whenever movement crosses a selectable value', () => {
    expect(shouldPlayTuneDialHaptic(9, 10, 1)).toBe(true)
    expect(shouldPlayTuneDialHaptic(10, 12, 1)).toBe(true)
    expect(shouldPlayTuneDialHaptic(11, 9, 1)).toBe(true)
    expect(shouldPlayTuneDialHaptic(3, 4, 1)).toBe(true)
  })

  test('scale ends are identified for stronger haptics', () => {
    expect(isTuneDialEdgeStep(0, 100)).toBe(true)
    expect(isTuneDialEdgeStep(100, 100)).toBe(true)
    expect(isTuneDialEdgeStep(99, 100)).toBe(false)
  })

  test('large moving release starts throw independently from dial layout', () => {
    const releaseVelocityX = -1200
    const translationX = -80

    expect(resolveTuneDialThrowVelocity(releaseVelocityX, translationX)).toBe(-900)
  })

  test('precise short adjustment never starts throw', () => {
    expect(resolveTuneDialThrowVelocity(-1800, -20)).toBe(0)
  })

  test('large drag released slowly never starts throw', () => {
    expect(resolveTuneDialThrowVelocity(-300, -120)).toBe(0)
  })

  test('opposite release wobble never starts throw', () => {
    expect(resolveTuneDialThrowVelocity(1200, -80)).toBe(0)
  })

  test('controlled value echoes cannot interrupt active dial interaction', () => {
    expect(shouldApplyExternalTuneDialValue(42, 45, true)).toBe(false)
    expect(shouldApplyExternalTuneDialValue(42, 45, false)).toBe(true)
    expect(shouldApplyExternalTuneDialValue(45, 45, false)).toBe(false)
  })

  test('throw distance is stable across frame rates', () => {
    function simulate(frameMs: number) {
      let velocity = resolveTuneDialThrowVelocity(-1800, -100)
      let distance = 0
      let elapsed = 0

      while (elapsed < 2000) {
        const elapsedMs = Math.min(frameMs, 2000 - elapsed)
        const next = advanceTuneDialThrow(velocity, elapsedMs)
        distance += next.distance
        velocity = next.velocity
        elapsed += elapsedMs
      }

      return distance
    }

    expect(simulate(1000 / 30)).toBeCloseTo(simulate(1000 / 60), 6)
    expect(simulate(1000 / 60)).toBeCloseTo(simulate(1000 / 120), 6)
  })

  test('throw target is known before animation starts', () => {
    expect(resolveTuneDialThrowTargetOffset(-400, -900, 1400)).toBe(-618.75)
    expect(resolveTuneDialThrowTargetOffset(-1300, -900, 1400)).toBe(-1400)
    expect(resolveTuneDialThrowTargetOffset(-100, 900, 1400)).toBe(0)
  })
})

test('converted physical endpoints survive integer gesture steps', () => {
  const max = 150 / 1.609344
  expect(tuneDialStepValue(93, 93, 0, max, 1, 0)).toBe(max)
  expect(tuneDialStepValue(0, 93, -max, max, 1, 0)).toBe(-max)
  expect(tuneDialStepValue(25, 93, 0, max, 1, 0)).toBe(25)
})
