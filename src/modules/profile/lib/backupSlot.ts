import type { SyncStatus } from 'vescape-core'

import { backupProgress } from '@/modules/profile/lib/backupStatus'

/** Why a backup exists but is not moving. Every reason is native's, not ours. */
export type BackupBlock = 'wifi' | 'offline' | 'paused'

/**
 * What the Settings Drawer knows about Ride History backup — native's `SyncStatus` narrowed to the
 * four shapes a strip cell can draw. The full sentence per state lives in `backupStatusCopy` for
 * the Sync settings screen; this is the same truth at tile width.
 */
export type BackupSlot =
  /** Backup is switched off, so nothing is pending by definition. */
  | { kind: 'off' }
  /** No Vescape account, so there is nothing to back up to. */
  | { kind: 'signedOut' }
  /** Signed in and nothing pending. */
  | { kind: 'idle'; lastUploadAtMs: number | null }
  /** A drain is running. `total` is the backlog it started with. */
  | { kind: 'syncing'; current: number; total: number }
  /** Rows are waiting on something the uploader cannot clear by itself. */
  | { kind: 'blocked'; reason: BackupBlock }

/**
 * Project native backup state onto the drawer's tile. `backlog` is the drain's high-water mark
 * (see `nextBackupBacklog`) — without it a running drain has no total to measure against.
 */
export function toBackupSlot(status: SyncStatus, backlog: number): BackupSlot {
  switch (status.activity) {
    case 'disabled':
      return { kind: 'off' }
    case 'signedOut':
      return { kind: 'signedOut' }
    case 'upToDate':
      return { kind: 'idle', lastUploadAtMs: status.lastUploadAtMs }
    case 'syncing':
      // An unmeasurable drain still reads as running; only its bar goes missing.
      return {
        kind: 'syncing',
        ...(backupProgress(status.pendingRows, backlog) ?? { current: 0, total: 0 }),
      }
    case 'waitingForWifi':
      return { kind: 'blocked', reason: 'wifi' }
    case 'offline':
      return { kind: 'blocked', reason: 'offline' }
    case 'paused':
      return { kind: 'blocked', reason: 'paused' }
  }
}

/** Drain progress as a 0–1 fraction, or null when nothing is running (or the total is unknown). */
export function backupProgressFraction(slot: BackupSlot): number | null {
  if (slot.kind !== 'syncing' || slot.total <= 0) return null
  return Math.min(1, Math.max(0, slot.current / slot.total))
}
