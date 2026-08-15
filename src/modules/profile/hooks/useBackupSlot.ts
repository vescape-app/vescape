import { useUser } from '@clerk/expo'

import type { BackupSlot } from '@/modules/profile/lib/backupSlot'

/**
 * The one place backup state enters the UI.
 *
 * TODO(#276): replace the body with a projection of `useSyncStatusStore` — `signedOut` →
 * `signedOut`, `upToDate` → `idle`, `syncing` → `syncing` with `backupProgress()` counts, and the
 * paused/offline reasons once the tile has copy for them.
 *
 * Until the uploader exists, no Rider is backing anything up. A signed-out Rider reads as
 * `signedOut` (the cell states the fact and offers sign-in, without claiming an account would
 * start a backup); a signed-in one reads as `unavailable`.
 */
export function useBackupSlot(): BackupSlot {
  const { isSignedIn } = useUser()
  return isSignedIn ? { kind: 'unavailable' } : { kind: 'signedOut' }
}
