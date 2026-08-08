import { describe, expect, test } from 'bun:test'

import {
  getMapRevealPitch,
  getPaddingForProfile,
  getPitchForZoom,
  getPitchForProfileZoom,
  getProfileZoomLevel,
  MAP_CAMERA_PROFILES,
} from '@/modules/map/lib/cameraProfiles'

describe('map reveal pitch', () => {
  test.each([
    ['GPS heading', 56],
    ['Compass', 52],
  ])('eases from the %s follow pitch without a first-frame jump', (_profile, basePitch) => {
    const startingPitch = getMapRevealPitch({
      basePitch,
      zoom: 16,
      revealProgress: 0,
      perspectiveEnabled: true,
    })
    const earlyPitch = getMapRevealPitch({
      basePitch,
      zoom: 15.935,
      revealProgress: 0.1,
      perspectiveEnabled: true,
    })
    const completedPitch = getMapRevealPitch({
      basePitch,
      zoom: 15.35,
      revealProgress: 1,
      perspectiveEnabled: true,
    })

    expect(startingPitch).toBe(basePitch)
    expect(earlyPitch).toBeLessThan(basePitch)
    expect(earlyPitch).toBeGreaterThan(50)
    expect(completedPitch).toBeCloseTo(39.15)
  })
})

describe('map camera profiles', () => {
  test('interpolates automatic map pitch continuously across the zoom range', () => {
    expect(getPitchForZoom(11, true)).toBe(0)
    expect(getPitchForZoom(13.5, true)).toBe(22.5)
    expect(getPitchForZoom(16, true)).toBe(45)
    expect(getPitchForZoom(13.5, false)).toBe(0)
  })

  test('removes tilt at far zoom for every profile', () => {
    for (const profile of Object.keys(
      MAP_CAMERA_PROFILES,
    ) as (keyof typeof MAP_CAMERA_PROFILES)[]) {
      expect(
        getPitchForProfileZoom({
          profile,
          zoom: 10,
          perspectiveEnabled: true,
          enforceMinimums: false,
        }),
      ).toBe(0)
    }
  })

  test('uses profile-specific maximum pitch at close zoom', () => {
    expect(
      getPitchForProfileZoom({
        profile: 'northUp',
        zoom: 17,
        perspectiveEnabled: true,
        enforceMinimums: false,
      }),
    ).toBe(MAP_CAMERA_PROFILES.northUp.maxPitch)
    expect(
      getPitchForProfileZoom({
        profile: 'rideHistory',
        zoom: 17,
        perspectiveEnabled: true,
        enforceMinimums: false,
      }),
    ).toBe(MAP_CAMERA_PROFILES.rideHistory.maxPitch)
    expect(
      getPitchForProfileZoom({
        profile: 'weather',
        zoom: 17,
        perspectiveEnabled: true,
        enforceMinimums: false,
      }),
    ).toBe(0)
  })

  test('keeps GPS heading and Compass as distinct follow profiles', () => {
    expect(MAP_CAMERA_PROFILES.gpsHeading).toMatchObject({
      headingPolicy: 'gpsHeading',
      maxPitch: 56,
      minimumPitch: 56,
    })
    expect(MAP_CAMERA_PROFILES.compass).toMatchObject({
      headingPolicy: 'compass',
      maxPitch: 52,
      minimumPitch: 52,
    })
  })

  test('derives heading profile zoom and padding minimums centrally', () => {
    expect(getProfileZoomLevel({ profile: 'gpsHeading', zoom: 13 })).toBe(16)
    expect(getPaddingForProfile({ profile: 'gpsHeading', viewportHeight: 1000 })).toEqual({
      paddingTop: 200,
      paddingRight: 0,
      paddingBottom: 0,
      paddingLeft: 0,
    })
  })
})
