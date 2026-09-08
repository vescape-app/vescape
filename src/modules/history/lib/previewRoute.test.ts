import { describe, expect, test } from 'bun:test'

import { getHistoryPreviewRoute } from '@/modules/history/lib/previewRoute'

describe('history preview route', () => {
  test('frames the camera on the Ride Track fixes already loaded', () => {
    expect(
      getHistoryPreviewRoute([
        { longitude: 19, latitude: 50 },
        { longitude: 19.2, latitude: 50.2 },
      ]),
    ).toEqual([
      [19, 50],
      [19.2, 50.2],
    ])
  })

  test('drops non-finite coordinates', () => {
    expect(getHistoryPreviewRoute([{ longitude: Number.NaN, latitude: 50 }])).toEqual([])
  })
})
