import { describe, expect, test } from 'bun:test'
import type { SyncStatus } from 'vescape-core'

import { backupProgressFraction, toBackupSlot } from './backupSlot'

const base: SyncStatus = {
  accountId: 'acc',
  pendingRows: 0,
  activity: 'upToDate',
  pause: null,
  lastUploadAtMs: 1_000,
}

describe('toBackupSlot', () => {
  test('carries the last upload through an idle status', () => {
    expect(toBackupSlot(base, 0)).toEqual({ kind: 'idle', lastUploadAtMs: 1_000 })
  })

  test('measures a drain against its backlog', () => {
    const slot = toBackupSlot({ ...base, activity: 'syncing', pendingRows: 30 }, 40)
    expect(slot).toEqual({ kind: 'syncing', current: 10, total: 40 })
    expect(backupProgressFraction(slot)).toBeCloseTo(0.25)
  })

  test('still reads as running when the backlog is unknown', () => {
    const slot = toBackupSlot({ ...base, activity: 'syncing', pendingRows: 5 }, 0)
    expect(slot).toEqual({ kind: 'syncing', current: 0, total: 0 })
    expect(backupProgressFraction(slot)).toBeNull()
  })

  test('names what a stalled backup is waiting for', () => {
    expect(toBackupSlot({ ...base, activity: 'waitingForWifi' }, 0)).toEqual({
      kind: 'blocked',
      reason: 'wifi',
    })
    expect(toBackupSlot({ ...base, activity: 'paused', pause: 'authentication' }, 0)).toEqual({
      kind: 'blocked',
      reason: 'paused',
    })
    expect(toBackupSlot({ ...base, activity: 'disabled' }, 0)).toEqual({ kind: 'off' })
    expect(toBackupSlot({ ...base, activity: 'signedOut' }, 0)).toEqual({ kind: 'signedOut' })
  })
})
