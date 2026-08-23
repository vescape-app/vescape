import { describe, expect, test } from 'bun:test'

import {
  deadBandPhoneHeading,
  type DeviceMotionMeasurement,
  phoneHeadingFromDeviceMotion,
  phoneHeadingSmoothingAlphaForTest,
  phoneHeadingUpdateIntervalMs,
  smoothPhoneHeading,
  startPhoneHeadingUpdates,
  type PhoneHeadingAdapter,
} from '@/modules/map/lib/phoneHeading'

const PORTRAIT = 0
const RIGHT_LANDSCAPE = 90

function motion(alpha: number, orientation = PORTRAIT): DeviceMotionMeasurement {
  return {
    rotation: { alpha, beta: 0, gamma: 0, timestamp: 0 },
    orientation,
  }
}

function fakeAdapter(
  options: { available?: boolean; permission?: string; headingOffsetDeg?: number } = {},
) {
  let listener: ((event: DeviceMotionMeasurement) => void) | null = null
  let removed = false
  const adapter: PhoneHeadingAdapter = {
    headingOffsetDeg: options.headingOffsetDeg ?? 0,
    isAvailableAsync: async () => options.available ?? true,
    getPermissionsAsync: async () => ({ status: options.permission ?? 'granted' }) as never,
    requestPermissionsAsync: async () => ({ status: options.permission ?? 'granted' }) as never,
    setUpdateInterval: () => {},
    addListener(nextListener) {
      listener = nextListener
      return {
        remove() {
          removed = true
        },
      }
    },
  }
  return {
    adapter,
    emit: (event: DeviceMotionMeasurement) => listener?.(event),
    removed: () => removed,
  }
}

describe('phoneHeading', () => {
  test('normalizes fused device motion heading and screen orientation', () => {
    expect(phoneHeadingFromDeviceMotion(motion(-Math.PI / 2))).toBe(90)
    expect(phoneHeadingFromDeviceMotion(motion(Math.PI / 2))).toBe(270)
    expect(phoneHeadingFromDeviceMotion(motion(0, RIGHT_LANDSCAPE))).toBe(90)
  })

  test('re-bases yaw onto the top edge of the phone for sources with an offset origin', () => {
    // iOS: `-yaw` is the bearing of the right edge, so the top edge is 90° counter-clockwise.
    expect(phoneHeadingFromDeviceMotion(motion(0), -90)).toBe(270)
    expect(phoneHeadingFromDeviceMotion(motion(-Math.PI / 2), -90)).toBe(0)
    expect(phoneHeadingFromDeviceMotion(motion(-Math.PI / 2, RIGHT_LANDSCAPE), -90)).toBe(90)
  })

  test('smooths compass heading across the shortest wrap-around path', () => {
    expect(smoothPhoneHeading(null, 90)).toBe(90)
    expect(smoothPhoneHeading(350, 10)).toBeCloseTo(351.244)
    expect(smoothPhoneHeading(10, 350)).toBeCloseTo(8.756)
  })

  test('uses adaptive smoothing', () => {
    expect(phoneHeadingSmoothingAlphaForTest(0, 2)).toBeLessThan(
      phoneHeadingSmoothingAlphaForTest(0, 90),
    )
    expect(smoothPhoneHeading(0, 90)).toBe(6)
    expect(smoothPhoneHeading(0, 90, 0.5)).toBe(3)
    expect(phoneHeadingUpdateIntervalMs()).toBe(16)
  })

  test('suppresses stationary jitter after smoothing without blocking real movement', () => {
    expect(deadBandPhoneHeading(100, 103)).toBe(100)
    expect(deadBandPhoneHeading(100, 104)).toBeGreaterThan(100.15)
    expect(deadBandPhoneHeading(359.8, 0.2)).toBe(359.8)
  })

  test('subscribes only after availability and permission checks', async () => {
    const source = fakeAdapter()
    const headings: number[] = []

    const subscription = await startPhoneHeadingUpdates(source.adapter, (heading) =>
      headings.push(heading),
    )
    source.emit(motion(Math.PI))
    subscription.remove()

    expect(subscription.status).toBe('ready')
    expect(headings).toEqual([180])
    expect(source.removed()).toBe(true)
  })

  test("applies the adapter's heading origin to the readings it emits", async () => {
    const source = fakeAdapter({ headingOffsetDeg: -90 })
    const headings: number[] = []

    const subscription = await startPhoneHeadingUpdates(source.adapter, (heading) =>
      headings.push(heading),
    )
    source.emit(motion(Math.PI))
    subscription.remove()

    expect(headings).toEqual([90])
  })

  test('returns fallback statuses without subscribing', async () => {
    const unavailable = await startPhoneHeadingUpdates(
      fakeAdapter({ available: false }).adapter,
      () => {},
    )
    const denied = await startPhoneHeadingUpdates(
      fakeAdapter({ permission: 'denied' }).adapter,
      () => {},
    )

    expect(unavailable.status).toBe('unavailable')
    expect(denied.status).toBe('denied')
  })
})
