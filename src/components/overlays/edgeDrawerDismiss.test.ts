import { describe, expect, test } from 'bun:test'

import {
  COMMIT_FRACTION,
  DRAWER_INITIAL_OPEN_FRACTION,
  edgeDrawerDismissOpacity,
  edgeDrawerOnScreenPixels,
  edgeDrawerRestoreOffset,
  edgeDrawerScrollEndAction,
  edgeDrawerVisibleFraction,
  type EdgeDrawerGeometry,
} from '@/components/overlays/edgeDrawerDismiss'

const HEIGHT = 900
/** A three-screen article: scroll travel dwarfs the screen. */
const LONG_RANGE = 3000
/** A drawer about a screen tall. */
const MEDIUM_RANGE = 900
/** A drawer that never fills the screen. */
const SHORT_RANGE = 300

const at = (offset: number, range: number, opensFromTop: boolean): EdgeDrawerGeometry => ({
  offset,
  range,
  height: HEIGHT,
  opensFromTop,
})

/** The offset a drawer sits at when it opens. */
const restingOffset = (range: number, opensFromTop: boolean) =>
  opensFromTop ? 0 : Math.min(range, HEIGHT * DRAWER_INITIAL_OPEN_FRACTION)

describe('edgeDrawerOnScreenPixels', () => {
  test('caps a long drawer at what the screen can actually show', () => {
    expect(edgeDrawerOnScreenPixels(at(0, LONG_RANGE, true))).toBe(HEIGHT)
    expect(edgeDrawerOnScreenPixels(at(1500, LONG_RANGE, true))).toBe(HEIGHT)
  })

  test('shrinks only once the drawer starts leaving the screen', () => {
    expect(edgeDrawerOnScreenPixels(at(LONG_RANGE - 600, LONG_RANGE, true))).toBe(600)
    expect(edgeDrawerOnScreenPixels(at(LONG_RANGE, LONG_RANGE, true))).toBe(0)
  })

  test('measures a bottom drawer from the other edge', () => {
    expect(edgeDrawerOnScreenPixels(at(0, LONG_RANGE, false))).toBe(0)
    expect(edgeDrawerOnScreenPixels(at(600, LONG_RANGE, false))).toBe(600)
    expect(edgeDrawerOnScreenPixels(at(LONG_RANGE, LONG_RANGE, false))).toBe(HEIGHT)
  })
})

describe('edgeDrawerVisibleFraction', () => {
  test('reads 1 at the opening position for every size and edge', () => {
    for (const range of [LONG_RANGE, MEDIUM_RANGE, SHORT_RANGE]) {
      for (const opensFromTop of [true, false]) {
        expect(
          edgeDrawerVisibleFraction(at(restingOffset(range, opensFromTop), range, opensFromTop)),
        ).toBe(1)
      }
    }
  })

  test('reads 0 once the drawer is fully off screen, for every size and edge', () => {
    for (const range of [LONG_RANGE, MEDIUM_RANGE, SHORT_RANGE]) {
      expect(edgeDrawerVisibleFraction(at(range, range, true))).toBe(0)
      expect(edgeDrawerVisibleFraction(at(0, range, false))).toBe(0)
    }
  })

  test('a long article scrolls without touching the dismissal', () => {
    // Reading the middle of a three-screen drawer must not dim it at all.
    expect(edgeDrawerVisibleFraction(at(1200, LONG_RANGE, true))).toBe(1)
    expect(edgeDrawerDismissOpacity(edgeDrawerVisibleFraction(at(1200, LONG_RANGE, true)))).toBe(1)
  })

  test('the same drag past the end reads the same on a long and a medium drawer', () => {
    const leftOnScreen = 450
    expect(edgeDrawerVisibleFraction(at(LONG_RANGE - leftOnScreen, LONG_RANGE, true))).toBe(
      edgeDrawerVisibleFraction(at(MEDIUM_RANGE - leftOnScreen, MEDIUM_RANGE, true)),
    )
  })

  test('scrolling a bottom drawer further open stays at rest, never above it', () => {
    const range = LONG_RANGE
    const opened = restingOffset(range, false)
    expect(edgeDrawerVisibleFraction(at(opened + 200, range, false))).toBe(1)
  })
})

describe('edgeDrawerDismissOpacity', () => {
  test('is fully opaque only when the drawer is fully present', () => {
    expect(edgeDrawerDismissOpacity(1)).toBe(1)
    expect(edgeDrawerDismissOpacity(0.99)).toBeLessThan(1)
  })

  test('buys visible transparency for the first bit of drag', () => {
    // A tenth of the drawer pushed away must read as clearly fading, not as untouched.
    expect(edgeDrawerDismissOpacity(0.9)).toBeLessThanOrEqual(0.75)
  })

  test('keeps something to see across the rest of the drag', () => {
    // The failure this guards: near zero a quarter of the way in, so the remaining three quarters
    // of the gesture change nothing and the whole dismissal reads as instant.
    const midway = (1 + COMMIT_FRACTION) / 2
    expect(edgeDrawerDismissOpacity(midway)).toBeGreaterThan(0.3)
  })

  test('is transparent exactly when the dismissal commits', () => {
    // Arriving at the close still visible leaves a timed animation to mop up, which is the pop.
    expect(edgeDrawerDismissOpacity(COMMIT_FRACTION)).toBe(0)
    expect(edgeDrawerDismissOpacity(COMMIT_FRACTION + 0.05)).toBeGreaterThan(0)
    expect(edgeDrawerDismissOpacity(0)).toBe(0)
  })

  test('falls without a step anywhere across the travel', () => {
    let previous = edgeDrawerDismissOpacity(1)
    for (let left = 1; left >= 0; left -= 0.01) {
      const opacity = edgeDrawerDismissOpacity(left)
      expect(opacity).toBeLessThanOrEqual(previous)
      // No jump: the drag must never buy a visible chunk of transparency at one point.
      expect(previous - opacity).toBeLessThan(0.1)
      previous = opacity
    }
  })
})

describe('edgeDrawerRestoreOffset', () => {
  test('lands exactly where the drawer is opaque again, for every size and edge', () => {
    for (const range of [LONG_RANGE, MEDIUM_RANGE, SHORT_RANGE]) {
      for (const opensFromTop of [true, false]) {
        const offset = edgeDrawerRestoreOffset(range, HEIGHT, opensFromTop)
        expect(offset).toBeGreaterThanOrEqual(0)
        expect(offset).toBeLessThanOrEqual(range)
        expect(
          edgeDrawerDismissOpacity(edgeDrawerVisibleFraction(at(offset, range, opensFromTop))),
        ).toBe(1)
      }
    }
  })

  test('keeps a long article where it was rather than yanking it home', () => {
    // The nearest offset that covers the screen again — the end of the article, not the top of it.
    expect(edgeDrawerRestoreOffset(LONG_RANGE, HEIGHT, true)).toBe(LONG_RANGE - HEIGHT)
  })
})

describe('edgeDrawerScrollEndAction', () => {
  test('leaves a drawer at rest alone', () => {
    expect(edgeDrawerScrollEndAction({ fullyHidden: false, visibleFraction: 1 })).toBe('stay-open')
  })

  test('settles a partly faded drawer back to full opacity', () => {
    expect(edgeDrawerScrollEndAction({ fullyHidden: false, visibleFraction: 0.8 })).toBe('restore')
  })

  test('closes once the drawer is past the commit mark', () => {
    expect(
      edgeDrawerScrollEndAction({ fullyHidden: false, visibleFraction: COMMIT_FRACTION }),
    ).toBe('close')
    expect(
      edgeDrawerScrollEndAction({ fullyHidden: false, visibleFraction: COMMIT_FRACTION / 2 }),
    ).toBe('close')
  })

  test('finishes without a fade once the drawer reaches its hidden edge', () => {
    expect(edgeDrawerScrollEndAction({ fullyHidden: true, visibleFraction: 0 })).toBe('finish')
  })

  test('every fraction resolves to exactly one action', () => {
    for (let fraction = 0; fraction <= 1; fraction += 0.01) {
      const action = edgeDrawerScrollEndAction({ fullyHidden: false, visibleFraction: fraction })
      expect(['close', 'restore', 'stay-open']).toContain(action)
    }
  })
})
