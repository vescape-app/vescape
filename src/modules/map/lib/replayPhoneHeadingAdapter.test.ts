import { describe, expect, mock, test } from 'bun:test'

import { phoneHeadingFromDeviceMotion } from '@/modules/map/lib/phoneHeading'

const listeners: ((event: { headingDeg: number }) => void)[] = []
const remove = mock(() => {})

mock.module('vescape-core', () => ({
  addReplayPhoneHeadingListener: (cb: (event: { headingDeg: number }) => void) => {
    listeners.push(cb)
    return { remove }
  },
}))

const { createReplayPhoneHeadingAdapter } =
  await import('@/modules/map/lib/replayPhoneHeadingAdapter')

function emit(headingDeg: number): void {
  for (const listener of listeners) listener({ headingDeg })
}

describe('createReplayPhoneHeadingAdapter', () => {
  /**
   * The whole point of standing in at the sensor boundary: what the layer decodes has to be the
   * bearing that was recorded, or every consumer downstream reads a different ride.
   */
  test('a recorded bearing survives the round trip through DeviceMotion', () => {
    const decoded: (number | null)[] = []
    createReplayPhoneHeadingAdapter().addListener((event) => {
      decoded.push(phoneHeadingFromDeviceMotion(event))
    })

    emit(0)
    emit(90)
    emit(217.5)
    emit(359)

    expect(decoded.map((value) => Math.round(value ?? -1))).toEqual([0, 90, 218, 359])
  })

  test('reports itself available and permitted, unlike an absent sensor', async () => {
    const adapter = createReplayPhoneHeadingAdapter()

    expect(await adapter.isAvailableAsync()).toBe(true)
    expect((await adapter.getPermissionsAsync()).status).toBe('granted')
  })

  test('removing the subscription detaches from the native stream', () => {
    const subscription = createReplayPhoneHeadingAdapter().addListener(() => {})

    subscription.remove()

    expect(remove).toHaveBeenCalled()
  })
})
