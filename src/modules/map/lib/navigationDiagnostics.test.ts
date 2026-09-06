import { describe, expect, test } from 'bun:test'
import type { LocationEvent } from 'vescape-core'

import {
  buildNavigationDiagnosticsViewModel,
  getNavigationFallbackReason,
} from '@/modules/map/lib/navigationDiagnostics'

const now = 20_000

function fix(overrides: Partial<LocationEvent> = {}): LocationEvent {
  return {
    latitude: 54,
    longitude: 15,
    timestamp: 18_000,
    accuracyM: 4.6,
    altitudeM: null,
    speedMps: 3,
    bearingDeg: 91,
    courseDeg: 91,
    courseSourceTimestamp: 18_000,
    precise: true,
    ...overrides,
  }
}

describe('navigation diagnostics', () => {
  test('formats ready gps heading evidence', () => {
    const vm = buildNavigationDiagnosticsViewModel({
      mapOrientationMode: 'gpsHeading',
      mapStyleKey: 'onedark',
      gpsFix: fix(),
      retainedGpsBearingDeg: 91,
      retainedGpsBearingAt: 18_500,
      phoneHeadingDeg: null,
      phoneHeadingStatus: 'idle',
      activeDisplayHeadingDeg: 90.6,
      cameraHeadingDeg: 89.8,
      fallbackReason: null,
      updatedAt: 19_750,
      now,
    })

    expect(vm.selectedMode).toBe('GPS heading')
    expect(vm.mapStyle).toBe('One Dark')
    expect(vm.readiness).toBe('ready')
    expect(vm.fallbackReason).toBe('none')
    expect(vm.updatedAge).toBe('250 ms')
    expect(vm.gpsRows).toContainEqual({ label: 'Raw bearing', value: '91 deg' })
    expect(vm.gpsRows).toContainEqual({ label: 'Retained age', value: '1.5 s' })
    expect(vm.headingRows).toContainEqual({ label: 'Camera heading', value: '90 deg' })
  })

  test('reports unavailable board fields and waiting compass fallback', () => {
    const vm = buildNavigationDiagnosticsViewModel({
      mapOrientationMode: 'phoneHeading',
      mapStyleKey: 'satellite',
      gpsFix: null,
      retainedGpsBearingDeg: null,
      retainedGpsBearingAt: null,
      phoneHeadingDeg: null,
      phoneHeadingStatus: 'permissionDenied',
      activeDisplayHeadingDeg: null,
      cameraHeadingDeg: null,
      fallbackReason: 'phone_heading_permissionDenied',
      updatedAt: null,
      now,
    })

    expect(vm.readiness).toBe('waiting')
    expect(vm.fallbackReason).toBe('compass permissionDenied')
    expect(vm.boardRows.every((row) => row.value === 'unavailable')).toBe(true)
  })

  test('computes fallback reasons deterministically', () => {
    expect(
      getNavigationFallbackReason({
        mapOrientationMode: 'gpsHeading',
        gpsFix: null,
        retainedGpsBearingDeg: null,
        phoneHeadingDeg: null,
        phoneHeadingStatus: 'idle',
      }),
    ).toBe('gps_fix_unavailable')
    expect(
      getNavigationFallbackReason({
        mapOrientationMode: 'phoneHeading',
        gpsFix: fix(),
        retainedGpsBearingDeg: 40,
        phoneHeadingDeg: null,
        phoneHeadingStatus: 'unavailable',
      }),
    ).toBe('phone_heading_unavailable')
  })
})
