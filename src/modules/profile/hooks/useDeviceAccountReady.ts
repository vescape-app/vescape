import { useSyncExternalStore } from 'react'
import { getDeviceCredentialState } from 'vescape-core'

import { readDeviceCredential } from '@/modules/profile/lib/readDeviceCredential'
import { useDeviceAuthStore } from '@/modules/profile/store/deviceAuthStore'

export function useDeviceAccountReady(): boolean {
  return useSyncExternalStore(
    useDeviceAuthStore.subscribe,
    () => readDeviceCredential(getDeviceCredentialState).status?.state === 'ready',
  )
}

export function useDeviceAccountId(): string | null {
  return useSyncExternalStore(useDeviceAuthStore.subscribe, () => {
    const credential = readDeviceCredential(getDeviceCredentialState).status
    return credential?.state === 'ready' ? credential.accountId : null
  })
}
