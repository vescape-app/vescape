import { useUser } from '@clerk/expo'

import type { BackupSlot } from '@/modules/profile/lib/backupSlot'

export function useBackupSlot(): BackupSlot {
  const { isSignedIn } = useUser()
  return isSignedIn ? { kind: 'unavailable' } : { kind: 'signedOut' }
}
