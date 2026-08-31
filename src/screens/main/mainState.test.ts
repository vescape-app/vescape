import { describe, expect, test } from 'bun:test'
import type { HistorySession } from '@/modules/history/store/historyStore'

import {
  findSessionIndex,
  getLatestSession,
  getNextRideSession,
  getPreviousRideSession,
} from '@/screens/main/mainState'

const sessions = [session('newest', 3000), session('middle', 2000), session('oldest', 1000)]

function session(id: string, startAtMs: number): HistorySession {
  return {
    id,
    boardId: 'dev-1',
    boardName: 'ADV',
    startAtMs,
    endAtMs: startAtMs + 60_000,
    movingStartAtMs: startAtMs,
    movingEndAtMs: startAtMs + 60_000,
    blockIds: [id],
    blockCount: 1,
    distanceM: 1200,
    maxSpeedKmh: 32,
    avgSpeedKmh: 18,
    sampleCount: 20,
    gpsPointCount: 20,
    preciseGpsPointCount: 18,
    maxTempMosfet: null,
    maxTempMotor: null,
    maxDuty: 0.5,
    batteryUsedWh: 0,
    batteryRegenWh: 0,
    firstLatitude: null,
    firstLongitude: null,
    centerLatitude: null,
    centerLongitude: null,
    minLatitude: null,
    maxLatitude: null,
    minLongitude: null,
    maxLongitude: null,
    boundaryBefore: 'none',
    routePoints: [],
  }
}

describe('mainState', () => {
  test('getLatestSession returns first session from store order', () => {
    expect(getLatestSession(sessions)?.id).toBe('newest')
    expect(getLatestSession([])).toBeNull()
  })

  test('getPreviousRideSession moves toward older sessions', () => {
    expect(getPreviousRideSession(sessions, sessions[0])?.id).toBe('middle')
    expect(getPreviousRideSession(sessions, sessions[1])?.id).toBe('oldest')
    expect(getPreviousRideSession(sessions, sessions[2])).toBeNull()
  })

  test('getNextRideSession moves toward newer sessions', () => {
    expect(getNextRideSession(sessions, sessions[2])?.id).toBe('middle')
    expect(getNextRideSession(sessions, sessions[1])?.id).toBe('newest')
    expect(getNextRideSession(sessions, sessions[0])).toBeNull()
  })

  test('nav resolves session after pagination expands its range', () => {
    const expanded = session('expanded-middle', 1800)
    expanded.endAtMs = 2600
    const pagedSessions = [sessions[0], expanded, sessions[2]]
    const staleSelected = session('stale-middle', 2000)
    staleSelected.endAtMs = 2060

    expect(findSessionIndex(pagedSessions, staleSelected)).toBe(1)
    expect(getPreviousRideSession(pagedSessions, staleSelected)?.id).toBe('oldest')
    expect(getNextRideSession(pagedSessions, staleSelected)?.id).toBe('newest')
  })
})
