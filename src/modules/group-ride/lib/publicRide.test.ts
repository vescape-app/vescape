import { expect, test } from 'bun:test'
import type { PublicRideStatus } from 'vescape-core'

import {
  publicRideChoice,
  publicRideTimeLeft,
  publicRideUntil,
} from '@/modules/group-ride/lib/publicRide'

const HOUR = 3_600_000
const status = (patch: Partial<PublicRideStatus>): PublicRideStatus => ({
  activation: 'waiting',
  until: null,
  live: false,
  supported: true,
  reason: null,
  ...patch,
})

test('a chosen duration round-trips through the end time native keeps', () => {
  const now = 1_000_000
  const until = publicRideUntil({ mode: 'hours', hours: 6 }, now)
  expect(until).toBe(now + 6 * HOUR)
  // Read back a moment later, it still shows the duration the rider picked.
  expect(publicRideChoice(status({ until }), now + 5_000)).toEqual({ mode: 'hours', hours: 6 })
})

test('a running timer shows the shortest duration covering the time left', () => {
  expect(publicRideChoice(status({ until: 5 * HOUR }), 0)).toEqual({ mode: 'hours', hours: 6 })
  expect(publicRideChoice(status({ until: 10 }), 0)).toEqual({ mode: 'hours', hours: 1 })
})

test('off and always carry no end time', () => {
  expect(publicRideUntil({ mode: 'always' }, 0)).toBeNull()
  expect(publicRideChoice(status({ activation: 'off', until: 99 }), 0)).toEqual({ mode: 'off' })
  expect(publicRideChoice(status({}), 0)).toEqual({ mode: 'always' })
})

test('time left counts down to the minute, rounded up so it never reads zero while visible', () => {
  const MINUTE = 60_000
  expect(publicRideTimeLeft(12 * HOUR, 0)).toBe('12 h')
  expect(publicRideTimeLeft(12 * HOUR, 18 * MINUTE)).toBe('11 h 42 m')
  expect(publicRideTimeLeft(42 * MINUTE, 0)).toBe('42 m')
  expect(publicRideTimeLeft(1_000, 0)).toBe('1 m')
  expect(publicRideTimeLeft(123 * HOUR, 0)).toBe('5 d 3 h')
  expect(publicRideTimeLeft(48 * HOUR, 0)).toBe('2 d')
})

test('no time left without a running timer', () => {
  expect(publicRideTimeLeft(null, 0)).toBeNull()
  expect(publicRideTimeLeft(10, 10)).toBeNull()
})
