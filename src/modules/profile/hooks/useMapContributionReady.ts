import { useSyncExternalStore } from 'react'
import { getDeviceCredentialState } from 'vescape-core'

import { readDeviceCredential } from '@/modules/profile/lib/readDeviceCredential'
import { useDeviceAuthStore } from '@/modules/profile/store/deviceAuthStore'

/**
 * Whether this device can contribute to server-owned data right now.
 *
 * The server authorizes on the Device Token, not on the Clerk session, and the two can disagree: a
 * signed-in rider whose token exchange failed would otherwise be shown an editor whose every write
 * the server refuses. Native owns the credential, so it is read as the snapshot; the JS auth store
 * is only the subscription that says when to read it again.
 */
export function useMapContributionReady(): boolean {
  return useSyncExternalStore(
    useDeviceAuthStore.subscribe,
    () => readDeviceCredential(getDeviceCredentialState).status?.state === 'ready',
  )
}
