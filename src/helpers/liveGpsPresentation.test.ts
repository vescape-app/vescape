import { describe, expect, test } from 'bun:test'
import type { LocationEvent } from 'vescape-core'

import { getLiveGpsPresentation } from './liveGpsPresentation'

function location(overrides: Partial<LocationEvent> = {}): LocationEvent {
  return {
    latitude: 50,
    longitude: 19,
    speedMps: null,
    bearingDeg: null,
    courseDeg: null,
    courseSourceTimestamp: null,
    accuracyM: 10,
    altitudeM: null,
    timestamp: 10_000,
    precise: true,
    ...overrides,
  }
}

describe('getLiveGpsPresentation', () => {
  test('uses approximate fix for initial camera and circle before first precise fix', () => {
    const approximate = location({ precise: false, accuracyM: 80 })

    expect(
      getLiveGpsPresentation({
        preciseFix: null,
        latestApproximateFix: approximate,
        initialApproximateFix: null,
      }),
    ).toMatchObject({
      cameraFix: approximate,
      accuracyFix: approximate,
      accuracyRadiusM: 80,
      nextInitialApproximateFix: approximate,
      degraded: false,
    })
  })

  test('keeps first approximate fix stable until precise fix arrives', () => {
    const first = location({ latitude: 50, precise: false, timestamp: 1_000 })
    const later = location({ latitude: 51, precise: false, timestamp: 2_000 })

    expect(
      getLiveGpsPresentation({
        preciseFix: null,
        latestApproximateFix: later,
        initialApproximateFix: first,
      }).cameraFix,
    ).toBe(first)
  })

  test('clears initial approximate fix once precise fix exists', () => {
    const precise = location({ timestamp: 3_000 })
    const approximate = location({ precise: false, timestamp: 1_000 })

    expect(
      getLiveGpsPresentation({
        preciseFix: precise,
        latestApproximateFix: approximate,
        initialApproximateFix: approximate,
      }),
    ).toMatchObject({
      cameraFix: precise,
      accuracyFix: precise,
      accuracyRadiusM: 10,
      nextInitialApproximateFix: null,
      degraded: false,
    })
  })

  test('shows degraded circle around precise fix after grace period', () => {
    const precise = location({ latitude: 50, longitude: 19, timestamp: 10_000, accuracyM: 5 })
    const approximate = location({
      latitude: 50.001,
      longitude: 19,
      timestamp: 13_000,
      precise: false,
      accuracyM: 30,
    })

    const presentation = getLiveGpsPresentation({
      preciseFix: precise,
      latestApproximateFix: approximate,
      initialApproximateFix: null,
    })

    expect(presentation.cameraFix).toBe(precise)
    expect(presentation.accuracyFix).toBe(precise)
    expect(presentation.accuracyRadiusM).toBeCloseTo(141, 0)
    expect(presentation.degraded).toBe(true)
  })

  test('ignores imprecise fixes inside grace period', () => {
    const precise = location({ timestamp: 10_000, accuracyM: 5 })
    const approximate = location({
      timestamp: 11_000,
      precise: false,
      accuracyM: 80,
    })

    expect(
      getLiveGpsPresentation({
        preciseFix: precise,
        latestApproximateFix: approximate,
        initialApproximateFix: null,
      }),
    ).toMatchObject({
      accuracyFix: precise,
      accuracyRadiusM: 5,
      degraded: false,
    })
  })

  test('passes the native course through as the direction bearing', () => {
    const precise = location({ courseDeg: 91, courseSourceTimestamp: 9_000 })

    expect(
      getLiveGpsPresentation({
        preciseFix: precise,
        latestApproximateFix: precise,
        initialApproximateFix: null,
      }),
    ).toMatchObject({
      directionBearingDeg: 91,
      directionBearingSourceTimestamp: 9_000,
    })
  })

  test('has no direction bearing without a precise fix', () => {
    const approximate = location({ precise: false, courseDeg: 91 })

    expect(
      getLiveGpsPresentation({
        preciseFix: null,
        latestApproximateFix: approximate,
        initialApproximateFix: null,
      }),
    ).toMatchObject({
      directionBearingDeg: null,
      directionBearingSourceTimestamp: null,
    })
  })
})
