import { useEffect } from 'react'

import { SERVER_URL } from '@/config/server'
import { getDeviceCredentialState, provisionDeviceCredential } from 'vescape-core'

import { readDeviceCredential } from '@/modules/profile/lib/readDeviceCredential'
import { useDeviceAuthStore } from '@/modules/profile/store/deviceAuthStore'

const deviceToken = process.env.EXPO_PUBLIC_E2E_DEVICE_TOKEN
const accountId = process.env.EXPO_PUBLIC_E2E_ACCOUNT_ID

export const e2eDeviceAccount = deviceToken && accountId ? { deviceToken, accountId } : null

export function E2eDeviceAuthSync({
  account,
}: {
  account: { deviceToken: string; accountId: string }
}) {
  const setStatus = useDeviceAuthStore((state) => state.setStatus)

  useEffect(() => {
    const credential = readDeviceCredential(getDeviceCredentialState).status
    if (credential?.state === 'ready' && credential.accountId === account.accountId) {
      setStatus('ready')
      return
    }
    setStatus('provisioning')
    provisionDeviceCredential(SERVER_URL, account.deviceToken, account.accountId)
      .then(() => setStatus('ready'))
      .catch((error: unknown) => setStatus('failed', String(error)))
  }, [account, setStatus])

  return null
}
