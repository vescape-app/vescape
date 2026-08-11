import { describe, expect, test } from 'bun:test'

import { buildRailPath } from '@/modules/board/lib/railProfile'

describe('buildRailPath', () => {
  test('keeps zero-smoothing presets as exact straight segments', () => {
    expect(
      buildRailPath(
        [
          [30, 32],
          [104, 37],
          [179, 32],
        ],
        [0, 0, 0],
      ),
    ).toBe('M30 32 L104 37 L179 32')
  })

  test('rounds a smoothed interior point with a quadratic corner', () => {
    expect(
      buildRailPath(
        [
          [30, 32],
          [104, 37],
          [179, 32],
        ],
        [0, 100, 0],
      ),
    ).toContain('Q104 37')
  })
})
