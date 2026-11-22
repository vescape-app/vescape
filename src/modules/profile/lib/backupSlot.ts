export type BackupSlot =
  | { kind: 'unavailable' }
  | { kind: 'signedOut' }
  | { kind: 'idle'; lastUploadAtMs: number | null }
  | { kind: 'syncing'; current: number; total: number }

export function backupProgressFraction(slot: BackupSlot): number | null {
  if (slot.kind !== 'syncing' || slot.total <= 0) return null
  return Math.min(1, Math.max(0, slot.current / slot.total))
}
