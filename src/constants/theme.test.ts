import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

import { accentColors, controlColors, neutralColors, telemetryColors } from '@/constants/theme'

function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map(
    (offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255,
  )
  const [red, green, blue] = channels.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  )
  return red * 0.2126 + green * 0.7152 + blue * 0.0722
}

function contrastRatio(first: string, second: string): number {
  const firstLuminance = relativeLuminance(first)
  const secondLuminance = relativeLuminance(second)
  return (
    (Math.max(firstLuminance, secondLuminance) + 0.05) /
    (Math.min(firstLuminance, secondLuminance) + 0.05)
  )
}

function androidColors(appearance: 'light' | 'dark'): Map<string, string> {
  const qualifier = appearance === 'dark' ? 'values-night' : 'values'
  const xml = readFileSync(
    `modules/vescape-core/android/src/main/res/${qualifier}/colors.xml`,
    'utf8',
  )
  return new Map(
    [...xml.matchAll(/<color name="([^"]+)">([^<]+)<\/color>/g)].map((match) => [
      match[1],
      match[2].toLowerCase(),
    ]),
  )
}

function snakeCase(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
}

describe('accent palettes', () => {
  test('every filled action pair meets AA text contrast in both appearances', () => {
    const failures: string[] = []
    for (const [appearance, palette] of Object.entries(accentColors)) {
      for (const [name, accent] of Object.entries(palette)) {
        const ratio = contrastRatio(accent.solid, accent.onSolid)
        if (ratio < 4.5) failures.push(`${appearance}.${name}: ${ratio.toFixed(2)}`)
      }
    }
    expect(failures).toEqual([])
  })

  test('light canvas is white and copy remains readable without decorative surface contrast', () => {
    const neutral = neutralColors.light

    expect(neutral.bg).toBe('#ffffff')
    expect(neutral.surface).toBe('#ffffff')
    expect(contrastRatio(neutral.textMuted, neutral.bg)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(accentColors.light.yellow.text, neutral.bg)).toBeGreaterThanOrEqual(4.5)
  })

  test('control foregrounds meet AA contrast on interactive surfaces', () => {
    const failures: string[] = []
    for (const [appearance, control] of Object.entries(controlColors)) {
      for (const role of ['text', 'textMuted', 'icon'] as const) {
        const ratio = contrastRatio(control[role], control.background)
        if (ratio < 4.5) failures.push(`${appearance}.${role}: ${ratio.toFixed(2)}`)
      }
    }
    expect(failures).toEqual([])
  })

  test('light telemetry strokes remain distinct on the white canvas', () => {
    const failures: string[] = []
    for (const [name, color] of Object.entries(telemetryColors.light)) {
      const ratio = contrastRatio(color, neutralColors.light.bg)
      if (ratio < 3) failures.push(`${name}: ${ratio.toFixed(2)}`)
    }
    expect(failures).toEqual([])
  })

  test('Android day/night resources match the semantic TypeScript palettes', () => {
    for (const appearance of ['light', 'dark'] as const) {
      const resources = androidColors(appearance)
      const families = [
        ['neutral', neutralColors[appearance]],
        ['control', controlColors[appearance]],
        ['telemetry', telemetryColors[appearance]],
      ] as const

      for (const [family, colors] of families) {
        for (const [role, value] of Object.entries(colors)) {
          expect(resources.get(`vescape_${family}_${snakeCase(role)}`)).toBe(value.toLowerCase())
        }
      }

      for (const [name, accent] of Object.entries(accentColors[appearance])) {
        const resourceName = name === 'groupRide' ? 'group_ride' : snakeCase(name)
        for (const role of ['color', 'light', 'text', 'bg', 'border'] as const) {
          expect(resources.get(`vescape_accent_${resourceName}_${role}`)).toBe(
            accent[role].toLowerCase(),
          )
        }
      }

      // Adaptive colors used with theme.alpha() need a native resource too. A missing
      // entry crashes Android's ColorPropConverter instead of falling back to JS.
      expect(resources.get('vescape_control_background_alpha_085')).toBe(
        `#d9${controlColors[appearance].background.slice(1)}`,
      )
    }
  })
})
