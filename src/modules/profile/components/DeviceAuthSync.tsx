import { useAuth, useSession } from '@clerk/expo'
import Constants from 'expo-constants'
import { useCallback, useEffect } from 'react'

import { SERVER_URL } from '@/config/server'
import {
  addAppStatusListener,
  clearDeviceCredential,
  getDeviceCredentialState,
  provisionDeviceCredential,
} from 'vescape-core'

import { useDeviceAuthStore } from '@/modules/profile/store/deviceAuthStore'
import { exchangeDeviceToken } from '@/modules/profile/lib/deviceAuth'
import {
  DeviceProvisioningSuspendedError,
  isDeviceProvisioningSuspended,
  resumeDeviceProvisioning,
  startDeviceProvisioning,
  type DeviceProvisioningSteps,
} from '@/modules/profile/lib/deviceProvisioning'
import { readDeviceCredential } from '@/modules/profile/lib/readDeviceCredential'

export function DeviceAuthSync() {
  const { getToken, isLoaded, isSignedIn, signOut } = useAuth({
    treatPendingAsSignedOut: false,
  })
  const { session } = useSession()
  const retryRequestId = useDeviceAuthStore((state) => state.retryRequestId)
  const setStatus = useDeviceAuthStore((state) => state.setStatus)
  const retry = useDeviceAuthStore((state) => state.retry)

  const tryProvision = useCallback(() => {
    if (!isLoaded || !isSignedIn || !session || isDeviceProvisioningSuspended()) return
    const credential = readDeviceCredential(getDeviceCredentialState)
    if (!credential.status) {
      setStatus('failed', credential.error)
      return
    }
    const state = credential.status.state
    if (state === 'ready') {
      setStatus('ready')
      return
    }
    if (state === 'rejected') {
      setStatus('failed', 'Native credential was rejected')
      clearDeviceCredential()
      void signOut()
      return
    }
    const run = startDeviceProvisioning(session.id, provisioningSteps(getToken))
    if (run === null) return
    setStatus('provisioning')
    run
      .then(() => setStatus('ready'))
      .catch((error: unknown) => {
        if (!(error instanceof DeviceProvisioningSuspendedError)) {
          setStatus('failed', visibleError(error))
        } else if (!isDeviceProvisioningSuspended()) {
          retry()
        }
      })
  }, [getToken, isLoaded, isSignedIn, retry, session, setStatus, signOut])

  useEffect(() => {
    if (!isLoaded || isSignedIn) return
    resumeDeviceProvisioning()
    setStatus('idle')
  }, [isLoaded, isSignedIn, setStatus])

  useEffect(() => {
    tryProvision()
  }, [retryRequestId, tryProvision])

  useEffect(() => {
    if (!isSignedIn) return
    const subscription = addAppStatusListener(() => {
      if (isDeviceProvisioningSuspended()) return
      const credential = readDeviceCredential(getDeviceCredentialState)
      if (!credential.status) {
        setStatus('failed', credential.error)
        return
      }
      const state = credential.status.state
      if (state === 'ready') {
        setStatus('ready')
      } else if (state === 'rejected') {
        clearDeviceCredential()
        void signOut()
      } else if (state === 'unavailable') {
        tryProvision()
      }
    })
    return () => subscription.remove()
  }, [isSignedIn, signOut, tryProvision, setStatus])

  return null
}

function provisioningSteps(getToken: () => Promise<string | null>): DeviceProvisioningSteps {
  return {
    getToken,
    exchange: (clerkToken) => {
      const appVersion = Constants.expoConfig?.version
      if (!appVersion) throw new Error('Installed app version is unavailable')
      return exchangeDeviceToken({ serverUrl: SERVER_URL, clerkToken, appVersion })
    },
    install: (body) => provisionDeviceCredential(SERVER_URL, body.deviceToken, body.accountId),
  }
}

function visibleError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/\s+/g, ' ').trim().slice(0, 160) || 'Unknown error'
}
