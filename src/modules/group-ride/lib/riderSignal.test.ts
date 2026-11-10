import { describe, expect, test } from 'bun:test'

import { signalTimeLeftMs, topRiderSignal } from '@/modules/group-ride/lib/riderSignal'

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

describe('topRiderSignal', () => {
  const clock = { relayNow: 1_100_000, receivedAt: 0 }
  const isCritical = (kind: string) =>
    kind === 'down' ? true : ['wait', 'battery'].includes(kind) ? false : null
  const at = (kind: string, startedAt: number, expiresAt = 1_600_000) => ({
    kind,
    lat: 1,
    lng: 2,
    startedAt,
    expiresAt,
  })

  test('a critical signal outranks a newer non-critical one', () => {
    const down = at('down', 1_000_000)
    expect(topRiderSignal([at('wait', 1_090_000), down], clock, isCritical, 0)).toBe(down)
  })

  test('the newest wins among equally critical signals', () => {
    const newer = at('battery', 1_050_000)
    expect(topRiderSignal([at('wait', 1_000_000), newer], clock, isCritical, 0)).toBe(newer)
  })

  test('skips expired signals and unknown kinds', () => {
    const live = at('wait', 1_000_000)
    const expired = at('down', 1_050_000, 1_090_000)
    expect(topRiderSignal([expired, at('meteor', 1_060_000), live], clock, isCritical, 0)).toBe(
      live,
    )
    expect(topRiderSignal([expired], clock, isCritical, 0)).toBeNull()
  })
})
