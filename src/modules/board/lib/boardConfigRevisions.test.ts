import { describe, expect, test } from 'bun:test'
import type { BoardConfigChangeDiff, BoardConfigRevision } from 'vescape-core'

import {
  groupBoardConfigRevisions,
  TUNING_SESSION_GAP_MS,
} from '@/modules/board/lib/boardConfigRevisions'

function makeRevision(
  id: number,
  createdAtMs: number,
  overrides: Partial<BoardConfigRevision> = {},
): BoardConfigRevision {
  return {
    id,
    boardId: 'board-1',
    refloatVersion: '1.3.0',
    schemaHash: 'hash-130',
    packageSignature: 1234,
    source: 'app',
    changes: [{ fieldId: 'kp', label: 'Angle P', unit: null, oldValue: 20, newValue: 22 }],
    tuneProfileId: null,
    createdAtMs,
    ...overrides,
  }
}

function diff(
  fieldId: string,
  oldValue: number | boolean | null,
  newValue: number | boolean | null,
): BoardConfigChangeDiff {
  return { fieldId, label: fieldId, unit: null, oldValue, newValue }
}

describe('groupBoardConfigRevisions', () => {
  test('groups consecutive app revisions within gap and selects pre-session target', () => {
    const t0 = 1_700_000_000_000
    const revisions: BoardConfigRevision[] = [
      makeRevision(5, t0 + 3 * 60_000, { changes: [diff('kp', 22, 24)] }),
      makeRevision(4, t0 + 2 * 60_000, { changes: [diff('kp', 20, 22)] }),
      makeRevision(3, t0 + 1 * 60_000, { changes: [diff('atr_strength_up', 1.0, 1.5)] }),
      makeRevision(2, t0, { source: 'external', changes: [] }),
    ]

    const entries = groupBoardConfigRevisions(revisions)
    expect(entries).toHaveLength(2)

    const session = entries[0]!
    expect(session.kind).toBe('session')
    if (session.kind !== 'session') throw new Error('expected session')
    expect(session.revisions.map((r) => r.id)).toEqual([5, 4, 3])
    expect(session.startedAtMs).toBe(t0 + 1 * 60_000)
    expect(session.endedAtMs).toBe(t0 + 3 * 60_000)
    expect(session.preSessionRevisionId).toBe(2)
    expect(session.netChanges).toEqual([diff('atr_strength_up', 1.0, 1.5), diff('kp', 20, 24)])

    expect(entries[1]!.kind).toBe('revision')
    if (entries[1]!.kind === 'revision') {
      expect(entries[1]!.revision.id).toBe(2)
    }
  })

  test('cancels fields returned to their pre-session value in netChanges', () => {
    const t0 = 1_700_000_000_000
    const revisions: BoardConfigRevision[] = [
      makeRevision(3, t0 + 60_000, { changes: [diff('kp', 25, 20)] }),
      makeRevision(2, t0 + 30_000, { changes: [diff('kp', 20, 25), diff('ki', 0.005, 0.008)] }),
      makeRevision(1, t0, { source: 'external', changes: [] }),
    ]

    const entries = groupBoardConfigRevisions(revisions)
    const session = entries[0]!
    expect(session.kind).toBe('session')
    if (session.kind !== 'session') throw new Error('expected session')
    expect(session.netChanges).toEqual([diff('ki', 0.005, 0.008)])
    expect(session.preSessionRevisionId).toBe(1)
  })

  test('splits revisions when gap exceeds TUNING_SESSION_GAP_MS', () => {
    const t0 = 1_700_000_000_000
    const revisions: BoardConfigRevision[] = [
      makeRevision(3, t0 + TUNING_SESSION_GAP_MS + 1),
      makeRevision(2, t0),
    ]

    const entries = groupBoardConfigRevisions(revisions)
    expect(entries.map((e) => e.kind)).toEqual(['revision', 'revision'])
  })

  test('keeps revisions within exact TUNING_SESSION_GAP_MS grouped', () => {
    const t0 = 1_700_000_000_000
    const revisions: BoardConfigRevision[] = [
      makeRevision(2, t0 + TUNING_SESSION_GAP_MS),
      makeRevision(1, t0),
    ]

    const entries = groupBoardConfigRevisions(revisions)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.kind).toBe('session')
    if (entries[0]!.kind === 'session') {
      expect(entries[0]!.preSessionRevisionId).toBeNull()
    }
  })

  test('does not group across non-app sources or different boards', () => {
    const t0 = 1_700_000_000_000
    const revisions: BoardConfigRevision[] = [
      makeRevision(5, t0 + 4_000, { source: 'app' }),
      makeRevision(4, t0 + 3_000, { source: 'revert' }),
      makeRevision(3, t0 + 2_000, { source: 'app' }),
      makeRevision(2, t0 + 1_000, { source: 'app', boardId: 'board-2' }),
    ]

    const entries = groupBoardConfigRevisions(revisions)
    expect(entries.map((e) => e.kind)).toEqual(['revision', 'revision', 'revision', 'revision'])
  })
})
