import { describe, expect, test } from 'bun:test'

import { getGpsPuckBearing } from '@/modules/map/lib/gpsPuckHeading'

describe('getGpsPuckBearing', () => {
  test.each(['northUp', 'freeRotate', 'phoneHeading'] as const)(
    'uses phone heading for the puck in %s mode',
    (orientationMode) => {
      expect(
        getGpsPuckBearing({
          orientationMode,
          approximateFix: false,
          phoneHeadingDeg: 42,
          gpsBearingDeg: 170,
        }),
      ).toBe(42)
    },
  )

  test('uses GPS course only in GPS heading mode', () => {
    expect(
      getGpsPuckBearing({
        orientationMode: 'gpsHeading',
        approximateFix: false,
        phoneHeadingDeg: 42,
        gpsBearingDeg: 170,
      }),
    ).toBe(170)
  })

  test('hides the arrow for an approximate fix', () => {
    expect(
      getGpsPuckBearing({
        orientationMode: 'northUp',
        approximateFix: true,
        phoneHeadingDeg: 42,
        gpsBearingDeg: 170,
      }),
    ).toBeNull()
  })
})
