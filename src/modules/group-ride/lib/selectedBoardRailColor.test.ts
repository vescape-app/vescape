import { expect, test } from 'bun:test'

import { accentColors, personalizationColorOptions } from '@/constants/theme'
import { railColor } from '@/modules/group-ride/lib/selectedBoardRailColor'

test('every rail color option resolves per appearance; group-ride is mint, unknown is no tint', () => {
  for (const { id } of personalizationColorOptions) {
    for (const appearance of ['light', 'dark'] as const) {
      expect(railColor(id, appearance)).toBe(
        accentColors[appearance][id === 'group-ride' ? 'mint' : id].color,
      )
    }
  }
  expect(accentColors.light.mint.color).not.toBe(accentColors.light.teal.color)
  expect(railColor('unknown', 'dark')).toBeNull()
  expect(railColor(undefined, 'dark')).toBeNull()
})
