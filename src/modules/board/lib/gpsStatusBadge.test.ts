import { describe, expect, it } from 'bun:test'

import {
  deriveGpsStatusBadge,
  GPS_STALE_FIX_TIMEOUT_MS,
  type GpsStatusBadge,
} from '@/modules/board/lib/gpsStatusBadge'

import type { LocationEvent } from 'vescape-core'

const NOW = 1_700_000_000_000

function fix(overrides: Partial<LocationEvent> = {}): LocationEvent {
  return {
    latitude: 52.23,
    longitude: 21.01,
    speedMps: 4,
    bearingDeg: 90,
    courseDeg: 90,
    courseSourceTimestamp: NOW,
    accuracyM: 6,
    altitudeM: 110,
    timestamp: NOW,
    precise: true,
    ...overrides,
  }
}

function kindOf(badge: GpsStatusBadge | null) {
  return badge?.kind ?? null
}

describe('deriveGpsStatusBadge', () => {
  it('says nothing while a fresh precise fix is arriving', () => {
    expect(deriveGpsStatusBadge({ phase: 'active', latestFix: fix(), nowMs: NOW })).toBeNull()
  })

  it('reports each unhealthy phase before looking at fixes', () => {
    const latestFix = fix()
    expect(kindOf(deriveGpsStatusBadge({ phase: 'error', latestFix, nowMs: NOW }))).toBe('blocked')
    expect(kindOf(deriveGpsStatusBadge({ phase: 'idle', latestFix, nowMs: NOW }))).toBe('off')
    expect(kindOf(deriveGpsStatusBadge({ phase: 'starting', latestFix, nowMs: NOW }))).toBe(
      'starting',
    )
  })

  it('reports a refusal even before a first fix', () => {
    expect(kindOf(deriveGpsStatusBadge({ phase: 'error', latestFix: null, nowMs: NOW }))).toBe(
      'blocked',
    )
  })

  it('waits for the first fix', () => {
    expect(kindOf(deriveGpsStatusBadge({ phase: 'active', latestFix: null, nowMs: NOW }))).toBe(
      'searching',
    )
  })

  it('calls a fix lost once it passes the native staleness window', () => {
    const stale = fix({ timestamp: NOW - GPS_STALE_FIX_TIMEOUT_MS })
    const fresh = fix({ timestamp: NOW - GPS_STALE_FIX_TIMEOUT_MS + 1 })

    expect(kindOf(deriveGpsStatusBadge({ phase: 'active', latestFix: stale, nowMs: NOW }))).toBe(
      'lost',
    )
    expect(deriveGpsStatusBadge({ phase: 'active', latestFix: fresh, nowMs: NOW })).toBeNull()
  })

  it('flags an approximate fix as weak', () => {
    const approximate = fix({ precise: false, accuracyM: 240 })

    expect(
      kindOf(deriveGpsStatusBadge({ phase: 'active', latestFix: approximate, nowMs: NOW })),
    ).toBe('weak')
  })

  it('treats a fix timestamped ahead of the clock as current', () => {
    const ahead = fix({ timestamp: NOW + 5_000 })

    expect(deriveGpsStatusBadge({ phase: 'active', latestFix: ahead, nowMs: NOW })).toBeNull()
  })
})
