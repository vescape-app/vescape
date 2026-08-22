import { describe, expect, test } from 'bun:test'
import type { SyncStatus } from 'vescape-core'

import { backupProgress, backupStatusCopy, nextBackupBacklog } from './backupStatus'

const status = (patch: Partial<SyncStatus>): SyncStatus => ({
  accountId: 'acc_1',
  pendingRows: 0,
  activity: 'upToDate',
  pause: null,
  lastUploadAtMs: null,
  ...patch,
})

const NOW = 1_800_000_000_000

describe('backupStatusCopy', () => {
  test('names every backup state, so a stopped backup never renders as nothing', () => {
    const activities: SyncStatus['activity'][] = [
      'disabled',
      'signedOut',
      'upToDate',
      'syncing',
      'waitingForWifi',
      'offline',
      'paused',
    ]
    for (const activity of activities) {
      expect(backupStatusCopy(status({ activity }), NOW).label).not.toBe('')
    }
  })

  test('distinguishes the three pause reasons the Rider has to act on', () => {
    const labels = (['authentication', 'protocol', 'rowTooLarge'] as const).map(
      (pause) => backupStatusCopy(status({ activity: 'paused', pause }), NOW).label,
    )
    expect(new Set(labels).size).toBe(3)
    // A pause with no reason is still a stopped backup, not an empty line.
    expect(backupStatusCopy(status({ activity: 'paused' }), NOW).label).toBe('Backup paused')
  })

  test('up to date carries the upload time only once there has been one', () => {
    expect(backupStatusCopy(status({ lastUploadAtMs: NOW - 5 * 60_000 }), NOW).label).toBe(
      'Backed up 5m ago',
    )
    expect(backupStatusCopy(status({}), NOW).label).toBe('Backed up')
  })

  test('syncing leaves the counts to the progress bar', () => {
    expect(backupStatusCopy(status({ activity: 'syncing', pendingRows: 4 }), NOW).label).toBe(
      'Backing up…',
    )
  })
})

describe('nextBackupBacklog', () => {
  test('holds the high-water mark while a drain runs, so progress never goes backwards', () => {
    let backlog = nextBackupBacklog(0, status({ activity: 'syncing', pendingRows: 900 }))
    expect(backlog).toBe(900)
    backlog = nextBackupBacklog(backlog, status({ activity: 'syncing', pendingRows: 400 }))
    expect(backlog).toBe(900)
  })

  test('rows recorded mid-drain raise the total instead of overflowing the bar', () => {
    const backlog = nextBackupBacklog(900, status({ activity: 'syncing', pendingRows: 1_200 }))
    expect(backlog).toBe(1_200)
  })

  test('an emptied queue ends the drain, so the next one measures itself afresh', () => {
    expect(nextBackupBacklog(900, status({ activity: 'upToDate' }))).toBe(0)
  })
})

describe('backupProgress', () => {
  test('measures delivered rows against the drain total', () => {
    expect(backupProgress(400, 1_000)).toEqual({ current: 600, total: 1_000 })
  })

  test('has nothing to draw without a backlog or without pending rows', () => {
    expect(backupProgress(0, 1_000)).toBeNull()
    expect(backupProgress(400, 0)).toBeNull()
  })

  test('a backlog first seen mid-drain reads as no progress rather than a full bar', () => {
    expect(backupProgress(1_000, 1_000)).toEqual({ current: 0, total: 1_000 })
  })
})
