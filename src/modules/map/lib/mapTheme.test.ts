import { describe, expect, test } from 'bun:test'

import { mapStyleForTheme, themeOverrideForMapStyle } from '@/modules/map/lib/mapTheme'

describe('themeOverrideForMapStyle', () => {
  test('explicit dark and light basemaps override only the current app session', () => {
    expect(themeOverrideForMapStyle('onedark')).toBe('dark')
    expect(themeOverrideForMapStyle('outdoors')).toBe('light')
    expect(themeOverrideForMapStyle('mapy')).toBe('light')
  })

  test('neutral imagery styles restore the configured theme', () => {
    expect(themeOverrideForMapStyle('satellite')).toBeNull()
  })

  test('configured appearance replaces a conflicting explicit basemap', () => {
    expect(mapStyleForTheme('onedark', 'light')).toBe('outdoors')
    expect(mapStyleForTheme('outdoors', 'dark')).toBe('onedark')
    expect(mapStyleForTheme('onedark', 'dark')).toBe('onedark')
    expect(mapStyleForTheme('outdoors', 'light')).toBe('outdoors')
  })

  test('configured appearance never replaces neutral imagery styles', () => {
    expect(mapStyleForTheme('satellite', 'light')).toBe('satellite')
    expect(mapStyleForTheme('satellite', 'dark')).toBe('satellite')
    expect(mapStyleForTheme('mapy', 'light')).toBe('mapy')
    expect(mapStyleForTheme('mapy', 'dark')).toBe('mapy')
  })
})
