import { describe, expect, test } from 'bun:test'

import { signalTimeLeftMs } from '@/modules/group-ride/lib/riderSignal'

const signal = { kind: 'down', lat: 1, lng: 2, startedAt: 1_000_000, expiresAt: 1_600_000 }

describe('signalTimeLeftMs', () => {
  test('counts down on the relay clock, ignoring how far off the phone clock is', () => {
    // The roster said relay time 1_100_000 when it arrived at local 50; 20 s have passed locally.
    const clock = { relayNow: 1_100_000, receivedAt: 50 }
    expect(signalTimeLeftMs(signal, clock, 20_050)).toBe(480_000)
  })

  test('never goes below zero once expired', () => {
    expect(signalTimeLeftMs(signal, { relayNow: 1_700_000, receivedAt: 0 }, 0)).toBe(0)
  })
})
