import { useSyncExternalStore } from 'react'
import { getDeviceCredentialState } from 'vescape-core'

import { readDeviceCredential } from '@/modules/profile/lib/readDeviceCredential'
import { useDeviceAuthStore } from '@/modules/profile/store/deviceAuthStore'

/**
 * Whether this device can make account-authorized server calls right now: Map Point writes and
 * the proxied map services (search, Directions).
 *
 * The server authorizes on the Device Token, not on the Clerk session, and the two can disagree: a
 * signed-in rider whose token exchange failed would otherwise be shown an editor whose every write
 * the server refuses. Native owns the credential, so it is read as the snapshot; the JS auth store
 * is only the subscription that says when to read it again.
 */
export function useDeviceAccountReady(): boolean {
  return useSyncExternalStore(
    useDeviceAuthStore.subscribe,
    () => readDeviceCredential(getDeviceCredentialState).status?.state === 'ready',
  )
}
