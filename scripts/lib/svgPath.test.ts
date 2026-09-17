import { describe, expect, it } from 'bun:test'

import { normalizeSvgPath } from './svgPath'

/** Pull the coordinate pairs out of a normalised path, in order. */
function points(d: string): [number, number][] {
  const pairs: [number, number][] = []
  for (const match of d.matchAll(/[MLC]([-\d.,]+)/g)) {
    const nums = (match[1] as string).split(',').map(Number)
    for (let i = 0; i < nums.length; i += 2) {
      pairs.push([nums[i] as number, nums[i + 1] as number])
    }
  }
  return pairs
}

describe('normalizeSvgPath', () => {
  it('resolves relative commands against the running point', () => {
    expect(normalizeSvgPath('M10,10 l5,0 l0,5 z')).toBe('M10,10L15,10L15,15Z')
  })

  it('expands h and v into lines', () => {
    expect(normalizeSvgPath('M0,0 H10 V10 h-4 v-4')).toBe('M0,0L10,0L10,10L6,10L6,6')
  })

  it('treats extra moveto pairs as linetos', () => {
    expect(normalizeSvgPath('M0,0 10,0 10,10')).toBe('M0,0L10,0L10,10')
  })

  it('returns a closed subpath to its start before the next command', () => {
    expect(normalizeSvgPath('M10,10 L20,10 Z l0,5')).toBe('M10,10L20,10ZL10,15')
  })

  it('spells out the control point an S mirrors', () => {
    // The first curve ends at 20,0 with its second control at 15,10, so S reflects to 25,-10.
    expect(normalizeSvgPath('M0,0 C5,10 15,10 20,0 S35,10 40,0')).toBe(
      'M0,0C5,10,15,10,20,0C25,-10,35,10,40,0',
    )
  })

  it('treats a leading S as having no control point to mirror', () => {
    expect(normalizeSvgPath('M0,0 S10,10 20,0')).toBe('M0,0C0,0,10,10,20,0')
  })

  it('converts a quadratic to the equivalent cubic', () => {
    expect(normalizeSvgPath('M0,0 Q30,30 60,0')).toBe('M0,0C20,20,40,20,60,0')
  })

  it('lands a quarter arc on its stated endpoint', () => {
    const end = points(normalizeSvgPath('M0,10 A10,10 0 0 1 10,0')).at(-1)
    expect(end?.[0]).toBeCloseTo(10, 3)
    expect(end?.[1]).toBeCloseTo(0, 3)
  })

  it('splits a full-circle-ish large arc into per-quadrant curves', () => {
    const d = normalizeSvgPath('M10,0 A10,10 0 1 1 -10,0')
    // A 180 degree sweep is two quadrants, so two cubics.
    expect(d.match(/C/g)?.length).toBe(2)
    const end = points(d).at(-1)
    expect(end?.[0]).toBeCloseTo(-10, 3)
    expect(end?.[1]).toBeCloseTo(0, 3)
  })

  it('grows radii too small to span the endpoints instead of giving up', () => {
    const end = points(normalizeSvgPath('M0,0 A1,1 0 0 1 20,0')).at(-1)
    expect(end?.[0]).toBeCloseTo(20, 3)
    expect(end?.[1]).toBeCloseTo(0, 3)
  })

  it('draws a zero-radius arc as a line', () => {
    expect(normalizeSvgPath('M0,0 A0,0 0 0 1 10,10')).toBe('M0,0C0,0,10,10,10,10')
  })

  it('rejects an argument count the command cannot take', () => {
    expect(() => normalizeSvgPath('M0,0 C1,1 2,2', 'broken')).toThrow(/not a multiple of 6/)
  })

  it('rejects arguments on a closepath', () => {
    expect(() => normalizeSvgPath('M0,0 Z5', 'broken')).toThrow(/takes no arguments/)
  })
})
