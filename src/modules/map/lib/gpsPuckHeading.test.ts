import { describe, expect, test } from 'bun:test'

import { getGpsPuckBearing } from '@/modules/map/lib/gpsPuckHeading'

describe('getGpsPuckBearing', () => {
  test('uses phone heading for the puck in compass mode', () => {
    expect(
      getGpsPuckBearing({
        orientationMode: 'phoneHeading',
        approximateFix: false,
        phoneHeadingDeg: 42,
        gpsBearingDeg: 170,
      }),
    ).toBe(42)
  })

  test.each(['gpsHeading', 'northUp', 'freeRotate'] as const)(
    'uses GPS course in %s mode, not where the phone points',
    (orientationMode) => {
      expect(
        getGpsPuckBearing({
          orientationMode,
          approximateFix: false,
          phoneHeadingDeg: 42,
          gpsBearingDeg: 170,
        }),
      ).toBe(170)
    },
  )

  test('hides the course arrow for an approximate fix', () => {
    expect(
      getGpsPuckBearing({
        orientationMode: 'northUp',
        approximateFix: true,
        phoneHeadingDeg: 42,
        gpsBearingDeg: 170,
      }),
    ).toBeNull()
  })

  test('keeps the compass arrow for an approximate fix', () => {
    expect(
      getGpsPuckBearing({
        orientationMode: 'phoneHeading',
        approximateFix: true,
        phoneHeadingDeg: 42,
        gpsBearingDeg: 170,
      }),
    ).toBe(42)
  })
})
