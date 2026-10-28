import { describe, expect, test } from 'bun:test'

import {
  COMMIT_FRACTION,
  DRAWER_INITIAL_OPEN_FRACTION,
  edgeDrawerContentResizeOffset,
  edgeDrawerFocusOffset,
  edgeDrawerDismissOpacity,
  edgeDrawerDragStartsAtEdge,
  edgeDrawerPastEdge,
  edgeDrawerStickyShift,
  edgeDrawerOnScreenPixels,
  edgeDrawerOpaqueFloorOffset,
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

describe('edgeDrawerContentResizeOffset', () => {
  const height = 900

  test('absorbs growth so the drawer stays put instead of fading', () => {
    const offset = edgeDrawerContentResizeOffset({
      offset: 500,
      previousRange: 500,
      range: 700,
      height,
    })
    expect(offset).toBe(700)
    expect(edgeDrawerVisibleFraction({ offset, range: 700, height, opensFromTop: false })).toBe(1)
  })

  test('follows growth that arrives one frame at a time', () => {
    let offset = 500
    let range = 500
    for (const grown of [520, 560, 620, 690]) {
      offset = edgeDrawerContentResizeOffset({ offset, previousRange: range, range: grown, height })
      range = grown
      expect(edgeDrawerVisibleFraction({ offset, range, height, opensFromTop: false })).toBe(1)
    }
  })

  test('leaves shrinking content to the native clamp', () => {
    expect(
      edgeDrawerContentResizeOffset({ offset: 700, previousRange: 900, range: 700, height }),
    ).toBe(700)
  })

  test('an opaque drawer stays at or above the fully opaque resting offset', () => {
    const range = 900
    const previousRange = 800
    const offset = edgeDrawerContentResizeOffset({
      offset: edgeDrawerRestoreOffset(previousRange, height, false),
      previousRange,
      range,
      height,
    })
    expect(offset).toBeGreaterThanOrEqual(edgeDrawerRestoreOffset(range, height, false))
    expect(edgeDrawerVisibleFraction({ offset, range, height, opensFromTop: false })).toBe(1)
  })

  test('a drawer mid dismissal drag is not snapped back up under the finger', () => {
    const offset = edgeDrawerContentResizeOffset({
      offset: 100,
      previousRange: 800,
      range: 900,
      height,
    })
    // Growth absorbed so the drag does not jump, but no pull back to the opaque mark.
    expect(offset).toBe(200)
    expect(offset).toBeLessThan(edgeDrawerRestoreOffset(900, height, false))
  })
})

test('focuses a virtualized row far below the first window at screen center without dismissal', () => {
  const rowOffset = HEIGHT + 64 + 80 * 96
  const itemHeight = 88
  for (const opensFromTop of [false, true]) {
    const range = rowOffset + HEIGHT
    const offset = edgeDrawerFocusOffset({
      offset: rowOffset,
      itemHeight,
      range,
      height: HEIGHT,
      opensFromTop,
    })
    expect(rowOffset - offset + itemHeight / 2).toBe(HEIGHT / 2)
    expect(edgeDrawerVisibleFraction({ offset, range, height: HEIGHT, opensFromTop })).toBe(1)
  }
  const range = 700
  const offset = edgeDrawerFocusOffset({
    offset: 100,
    itemHeight,
    range,
    height: HEIGHT,
    opensFromTop: false,
  })
  expect(edgeDrawerVisibleFraction({ offset, range, height: HEIGHT, opensFromTop: false })).toBe(1)
})

describe('edgeDrawerDragStartsAtEdge', () => {
  test('a drawer that fits on screen dismisses from any pull', () => {
    expect(edgeDrawerDragStartsAtEdge(at(0, SHORT_RANGE, true))).toBe(true)
    expect(edgeDrawerDragStartsAtEdge(at(SHORT_RANGE, SHORT_RANGE, false))).toBe(true)
    expect(edgeDrawerDragStartsAtEdge(at(MEDIUM_RANGE, MEDIUM_RANGE, false))).toBe(true)
  })

  test('a long drawer dismisses only from its content edge', () => {
    const topEdge = edgeDrawerRestoreOffset(LONG_RANGE, HEIGHT, true)
    expect(edgeDrawerDragStartsAtEdge(at(topEdge, LONG_RANGE, true))).toBe(true)
    expect(edgeDrawerDragStartsAtEdge(at(topEdge - 200, LONG_RANGE, true))).toBe(false)
    const bottomEdge = edgeDrawerRestoreOffset(LONG_RANGE, HEIGHT, false)
    expect(edgeDrawerDragStartsAtEdge(at(bottomEdge, LONG_RANGE, false))).toBe(true)
    expect(edgeDrawerDragStartsAtEdge(at(bottomEdge + 200, LONG_RANGE, false))).toBe(false)
  })
})

describe('edgeDrawerPastEdge', () => {
  test('only the dismissal side of the content edge counts', () => {
    const topEdge = edgeDrawerRestoreOffset(LONG_RANGE, HEIGHT, true)
    expect(edgeDrawerPastEdge(at(topEdge, LONG_RANGE, true))).toBe(false)
    expect(edgeDrawerPastEdge(at(topEdge + 40, LONG_RANGE, true))).toBe(true)
    expect(edgeDrawerPastEdge(at(topEdge - 40, LONG_RANGE, true))).toBe(false)
    const bottomEdge = edgeDrawerRestoreOffset(LONG_RANGE, HEIGHT, false)
    expect(edgeDrawerPastEdge(at(bottomEdge - 40, LONG_RANGE, false))).toBe(true)
    expect(edgeDrawerPastEdge(at(bottomEdge + 40, LONG_RANGE, false))).toBe(false)
  })
})

describe('edgeDrawerStickyShift', () => {
  test('leading chrome follows the scroll once it reaches its pin', () => {
    expect(edgeDrawerStickyShift({ offset: 0, start: 900, pinAt: 40, maxShift: 2000 })).toBe(0)
    expect(edgeDrawerStickyShift({ offset: 1000, start: 900, pinAt: 40, maxShift: 2000 })).toBe(140)
    expect(edgeDrawerStickyShift({ offset: 5000, start: 900, pinAt: 40, maxShift: 2000 })).toBe(
      2000,
    )
  })

  test('trailing chrome is pulled up to its pin while the body runs off screen', () => {
    expect(edgeDrawerStickyShift({ offset: 0, end: 3000, pinAt: 860, maxShift: 2500 })).toBe(-2140)
    expect(edgeDrawerStickyShift({ offset: 2140, end: 3000, pinAt: 860, maxShift: 2500 })).toBe(-0)
    expect(edgeDrawerStickyShift({ offset: 0, end: 3000, pinAt: 860, maxShift: 100 })).toBe(-100)
  })
})

describe('edgeDrawerOpaqueFloorOffset', () => {
  test('an opaque drawer stays opaque when its rows grow in', () => {
    const offset = edgeDrawerRestoreOffset(SHORT_RANGE, HEIGHT, false)
    const grown = edgeDrawerOpaqueFloorOffset({
      offset,
      range: LONG_RANGE,
      previousRange: SHORT_RANGE,
      height: HEIGHT,
    })
    expect(edgeDrawerVisibleFraction(at(grown, LONG_RANGE, false))).toBe(1)
  })

  test('leaves a drawer scrolled into its content where it is', () => {
    expect(
      edgeDrawerOpaqueFloorOffset({
        offset: 2000,
        range: LONG_RANGE + 500,
        previousRange: LONG_RANGE,
        height: HEIGHT,
      }),
    ).toBe(2000)
  })

  test('never pulls back a drawer the rider is dismissing', () => {
    expect(
      edgeDrawerOpaqueFloorOffset({
        offset: 100,
        range: LONG_RANGE,
        previousRange: SHORT_RANGE,
        height: HEIGHT,
      }),
    ).toBe(100)
  })
})
