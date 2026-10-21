import { describe, expect, test } from 'bun:test'

import { mapStyleForTheme } from '@/modules/map/lib/mapTheme'

describe('mapStyleForTheme', () => {
  test('shared option and saved legacy variants follow effective theme', () => {
    for (const savedStyle of ['onedark', 'outdoors'] as const) {
      expect(mapStyleForTheme(savedStyle, 'dark')).toBe('onedark')
      expect(mapStyleForTheme(savedStyle, 'light')).toBe('outdoors')
    }
  })

  test('satellite and Mapy survive any effective theme', () => {
    for (const savedStyle of ['satellite', 'mapy'] as const) {
      expect(mapStyleForTheme(savedStyle, 'dark')).toBe(savedStyle)
      expect(mapStyleForTheme(savedStyle, 'light')).toBe(savedStyle)
    }
  })
})
