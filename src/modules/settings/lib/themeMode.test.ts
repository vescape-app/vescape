import { describe, expect, test } from 'bun:test'

import {
  outdoorLightProgress,
  resolveThemeMode,
  solarElevationDegrees,
} from '@/modules/settings/lib/themeMode'

const WARSAW = { latitude: 52.2297, longitude: 21.0122 }

describe('resolveThemeMode', () => {
  test('manual modes ignore system appearance', () => {
    expect(
      resolveThemeMode({
        mode: 'light',
        systemTheme: 'dark',
        date: new Date('2026-07-31T22:00:00Z'),
      }),
    ).toBe('light')
    expect(
      resolveThemeMode({
        mode: 'dark',
        systemTheme: 'light',
        date: new Date('2026-07-31T10:00:00Z'),
      }),
    ).toBe('dark')
  })

  test('system mode follows the OS and defaults dark when unavailable', () => {
    const date = new Date('2026-07-31T10:00:00Z')
    expect(resolveThemeMode({ mode: 'system', systemTheme: 'light', date })).toBe('light')
    expect(resolveThemeMode({ mode: 'system', systemTheme: null, date })).toBe('dark')
  })

  test('sun mode resolves from local daylight and falls back to the system', () => {
    expect(
      resolveThemeMode({
        mode: 'sun',
        systemTheme: 'dark',
        date: new Date('2026-07-31T10:00:00Z'),
        coordinate: WARSAW,
      }),
    ).toBe('light')
    expect(
      resolveThemeMode({
        mode: 'sun',
        systemTheme: 'light',
        date: new Date('2026-07-31T22:00:00Z'),
        coordinate: WARSAW,
      }),
    ).toBe('dark')
    expect(
      resolveThemeMode({
        mode: 'sun',
        systemTheme: 'light',
        date: new Date('2026-07-31T22:00:00Z'),
        coordinate: null,
      }),
    ).toBe('light')
  })

  test('session map override wins without changing the durable mode', () => {
    expect(
      resolveThemeMode({
        mode: 'system',
        systemTheme: 'light',
        date: new Date('2026-07-31T10:00:00Z'),
        sessionOverride: 'dark',
      }),
    ).toBe('dark')
  })
})

describe('solar light', () => {
  test('solar elevation and tone distinguish Warsaw noon, dusk, and night', () => {
    const noon = new Date('2026-07-31T10:00:00Z')
    const dusk = new Date('2026-07-31T18:45:00Z')
    const night = new Date('2026-07-31T22:00:00Z')
    expect(solarElevationDegrees(noon, WARSAW)).toBeGreaterThan(45)
    expect(outdoorLightProgress(noon, WARSAW)).toBe(1)
    expect(outdoorLightProgress(dusk, WARSAW)).toBeGreaterThan(0)
    expect(outdoorLightProgress(dusk, WARSAW)).toBeLessThan(1)
    expect(outdoorLightProgress(night, WARSAW)).toBe(0)
  })
})
