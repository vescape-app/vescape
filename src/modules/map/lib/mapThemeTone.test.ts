import { describe, expect, test } from 'bun:test'

import { resolveMapThemeTone } from '@/modules/map/lib/mapThemeTone'

describe('resolveMapThemeTone', () => {
  test('dark night is dimmer and less saturated than daylight', () => {
    const day = resolveMapThemeTone({
      theme: 'dark',
      outdoorLight: 1,
      imageryOpacity: 1,
      imagerySaturation: 0,
    })
    const night = resolveMapThemeTone({
      theme: 'dark',
      outdoorLight: 0,
      imageryOpacity: 1,
      imagerySaturation: 0,
    })
    expect(night.imageryOpacity).toBeLessThan(day.imageryOpacity)
    expect(night.imagerySaturation).toBeLessThan(day.imagerySaturation)
    expect(night.imageryContrast).toBeLessThan(day.imageryContrast)
    expect(night.roadLineOpacity).toBeLessThan(day.roadLineOpacity)
  })

  test('light theme remains clearer than dark theme while still adapting at night', () => {
    const lightNight = resolveMapThemeTone({
      theme: 'light',
      outdoorLight: 0,
      imageryOpacity: 1,
      imagerySaturation: 0,
    })
    const darkNight = resolveMapThemeTone({
      theme: 'dark',
      outdoorLight: 0,
      imageryOpacity: 1,
      imagerySaturation: 0,
    })
    expect(lightNight.imageryOpacity).toBeGreaterThan(darkNight.imageryOpacity)
    expect(lightNight.imagerySaturation).toBeGreaterThan(darkNight.imagerySaturation)
    expect(lightNight.imageryContrast).toBeGreaterThan(darkNight.imageryContrast)
  })

  test('light theme keeps satellite imagery bright without outdoor-light dimming', () => {
    const day = resolveMapThemeTone({
      theme: 'light',
      outdoorLight: 1,
      imageryOpacity: 1,
      imagerySaturation: 0,
    })
    const night = resolveMapThemeTone({
      theme: 'light',
      outdoorLight: 0,
      imageryOpacity: 1,
      imagerySaturation: 0,
    })
    expect(day).toEqual({
      imageryOpacity: 0.96,
      imagerySaturation: -0.03,
      imageryContrast: -0.02,
      roadLineOpacity: 0.75,
    })
    expect(night).toEqual(day)
  })

  test('light theme keeps low-opacity telemetry satellite imagery legible', () => {
    const tone = resolveMapThemeTone({
      theme: 'light',
      outdoorLight: 0,
      imageryOpacity: 0.2,
      imagerySaturation: -0.35,
    })

    expect(tone.imageryOpacity).toBeCloseTo(0.448)
    expect(tone.imagerySaturation).toBeCloseTo(-0.38)
  })

  test('keeps manual values inside Mapbox ranges', () => {
    const tone = resolveMapThemeTone({
      theme: 'dark',
      outdoorLight: Number.POSITIVE_INFINITY,
      imageryOpacity: 8,
      imagerySaturation: -8,
    })
    expect(tone.imageryOpacity).toBe(1)
    expect(tone.imagerySaturation).toBe(-1)
    expect(tone.imageryContrast).toBeCloseTo(-0.22)
    expect(tone.roadLineOpacity).toBe(0.65)
  })
})
