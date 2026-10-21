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
import { readDeviceCredential } from '@/modules/profile/lib/readDeviceCredential'

let provisioning: Promise<void> | null = null
const attemptedSessionIds = new Set<string>()

export function DeviceAuthSync() {
  const { getToken, isLoaded, isSignedIn, signOut } = useAuth({
    treatPendingAsSignedOut: false,
  })
  const { session } = useSession()
  const retryRequestId = useDeviceAuthStore((state) => state.retryRequestId)
  const setStatus = useDeviceAuthStore((state) => state.setStatus)

  const tryProvision = useCallback(() => {
    if (!isLoaded || !isSignedIn || !session) return
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
    if (provisioning !== null || attemptedSessionIds.has(session.id)) return

    attemptedSessionIds.add(session.id)
    setStatus('provisioning')
    provisioning = provision(getToken)
      .then(() => setStatus('ready'))
      .catch((error: unknown) => {
        attemptedSessionIds.delete(session.id)
        setStatus('failed', visibleError(error))
      })
      .finally(() => {
        provisioning = null
      })
  }, [getToken, isLoaded, isSignedIn, session, setStatus, signOut])

  useEffect(() => {
    if (isLoaded && !isSignedIn) setStatus('idle')
  }, [isLoaded, isSignedIn, setStatus])

  useEffect(() => {
    tryProvision()
  }, [retryRequestId, tryProvision])

  useEffect(() => {
    if (!isSignedIn) return
    const subscription = addAppStatusListener(() => {
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

async function provision(getToken: () => Promise<string | null>): Promise<void> {
  const clerkToken = await getToken()
  if (!clerkToken) throw new Error('Clerk session token is unavailable')
  const appVersion = Constants.expoConfig?.version
  if (!appVersion) throw new Error('Installed app version is unavailable')
  const body = await exchangeDeviceToken({ serverUrl: SERVER_URL, clerkToken, appVersion })
  await provisionDeviceCredential(SERVER_URL, body.deviceToken, body.accountId)
}

function visibleError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/\s+/g, ' ').trim().slice(0, 160) || 'Unknown error'
}
