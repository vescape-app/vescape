import { toBackupSlot, type BackupSlot } from '@/modules/profile/lib/backupSlot'
import { useSyncStatusStore } from '@/modules/profile/store/syncStatusStore'

/**
 * The one place backup state enters the Settings Drawer. Native owns every transition; this only
 * narrows the live status to what a strip cell can draw.
 */
export function useBackupSlot(): BackupSlot {
  const status = useSyncStatusStore((s) => s.status)
  const backlog = useSyncStatusStore((s) => s.backlog)
  return toBackupSlot(status, backlog)
}
