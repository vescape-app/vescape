import { describe, expect, test } from 'bun:test'

import { accentColors, theme } from '@/constants/theme'
import { riderMapColor, riderPaletteIndex } from '@/modules/group-ride/lib/riderColor'

/**
 * Shared test vector: the same ids must land in the same palette slots on every platform.
 *
 * @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/watch/GroupRideFrameBuilderTest.kt `RIDER_COLOR_VECTOR`
 * @parity /modules/vescape-core/ios/watch/GroupRideFrameBuilderTests.swift `riderColorVector`
 */
const RIDER_COLOR_VECTOR: [string, number][] = [
  ['', 1],
  ['a', 0],
  ['rider-1', 2],
  ['rider-7', 3],
  ['rider-3', 4],
  ['550e8400-e29b-41d4-a716-446655440000', 2],
  ['Jonáš', 4],
  ['Zoë', 0],
]

describe('riderPaletteIndex', () => {
  test('FNV-1a over UTF-8 bytes picks the shared palette slot', () => {
    for (const [id, index] of RIDER_COLOR_VECTOR)
      expect([id, riderPaletteIndex(id)]).toEqual([id, index])
  })
})

describe('riderMapColor', () => {
  test('a Rider keeps their palette color; stale or away only mutes it', () => {
    const accents = accentColors.light
    expect(riderMapColor({ id: 'rider-7', stale: false }, accents)).toBe(accents.fuchsia.color)
    expect(riderMapColor({ id: 'rider-1', stale: false }, accents)).toBe(accents.amber.color)
    expect(riderMapColor({ id: 'rider-7', stale: true }, accents)).toBe(
      theme.palette.slate.textMuted,
    )
  })
})
