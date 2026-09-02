import { useAuth, useSession } from '@clerk/expo'
import Constants from 'expo-constants'
import { useCallback, useEffect, useState } from 'react'

import { SERVER_URL } from '@/config/server'
import {
  addAppStatusListener,
  clearDeviceCredential,
  confirmSyncAccountReset,
  getDeviceCredentialState,
  provisionDeviceCredential,
} from 'vescape-core'

import { ConfirmModal } from '@/components/modals/ConfirmModal'
import { BackupChoiceModal } from '@/modules/profile/components/BackupChoiceModal'

import {
  useDeviceAuthStore,
  type PendingAccountReset,
} from '@/modules/profile/store/deviceAuthStore'
import { exchangeDeviceToken } from '@/modules/profile/lib/deviceAuth'

let provisioning: Promise<void> | null = null

const ACCOUNT_RESET_MESSAGE =
  'This phone already holds another rider account\u2019s data. Signing in with a different ' +
  'account erases every board, ride, favorite and setting stored here. Backups cannot be ' +
  'restored in this version, so what is erased is gone.'
const attemptedSessionIds = new Set<string>()

export function DeviceAuthSync() {
  const { getToken, isLoaded, isSignedIn, signOut } = useAuth({
    treatPendingAsSignedOut: false,
  })
  const { session } = useSession()
  const retryRequestId = useDeviceAuthStore((state) => state.retryRequestId)
  const setStatus = useDeviceAuthStore((state) => state.setStatus)
  const setPendingAccountReset = useDeviceAuthStore((state) => state.setPendingAccountReset)
  const pendingAccountReset = useDeviceAuthStore((state) => state.pendingAccountReset)
  const [resetting, setResetting] = useState(false)

  const tryProvision = useCallback(() => {
    if (!isLoaded || !isSignedIn || !session) return
    const state = getDeviceCredentialState().state
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
      .then((pending) => {
        // A different Account cannot activate backup until the Rider confirms that all local app
        // data is erased; native has stored nothing yet, so cancelling leaves this phone untouched.
        // The session is un-attempted again so a Rider who cancels, or whose confirm fails, can
        // retry instead of being stuck with no credential and no way to ask for one.
        if (pending) attemptedSessionIds.delete(session.id)
        setPendingAccountReset(pending)
        setStatus(pending ? 'idle' : 'ready')
      })
      .catch((error: unknown) => {
        attemptedSessionIds.delete(session.id)
        setStatus('failed', visibleError(error))
      })
      .finally(() => {
        provisioning = null
      })
  }, [getToken, isLoaded, isSignedIn, session, setPendingAccountReset, setStatus, signOut])

  useEffect(() => {
    if (isLoaded && !isSignedIn) setStatus('idle')
  }, [isLoaded, isSignedIn, setStatus])

  useEffect(() => {
    tryProvision()
  }, [retryRequestId, tryProvision])

  useEffect(() => {
    if (!isSignedIn) return
    const subscription = addAppStatusListener(() => {
      const state = getDeviceCredentialState().state
      if (state === 'rejected') {
        clearDeviceCredential()
        void signOut()
      } else if (state === 'unavailable') {
        tryProvision()
      }
    })
    return () => subscription.remove()
  }, [isSignedIn, signOut, tryProvision])

  const confirmReset = useCallback(async () => {
    if (!pendingAccountReset) return
    setResetting(true)
    try {
      await confirmSyncAccountReset(
        pendingAccountReset.serverUrl,
        pendingAccountReset.deviceToken,
        pendingAccountReset.accountId,
      )
      setPendingAccountReset(null)
      setStatus('ready')
    } catch (error: unknown) {
      setStatus('failed', visibleError(error))
    } finally {
      setResetting(false)
    }
  }, [pendingAccountReset, setPendingAccountReset, setStatus])

  // Cancelling leaves the old database and its Account binding untouched, so the Rider stays signed
  // out of backup rather than losing anything.
  const cancelReset = useCallback(() => {
    setPendingAccountReset(null)
    clearDeviceCredential()
    void signOut()
  }, [setPendingAccountReset, signOut])

  return (
    <>
      <BackupChoiceModal />
      <ConfirmModal
        visible={pendingAccountReset !== null}
        title="Erase this phone's data?"
        message={ACCOUNT_RESET_MESSAGE}
        confirmLabel="Erase and continue"
        cancelLabel="Cancel"
        destructive
        loading={resetting}
        onConfirm={confirmReset}
        onCancel={cancelReset}
      />
    </>
  )
}

/**
 * Exchange the Clerk session for a Device Token and hand it to native.
 *
 * Resolves with the pending reset when native reports that this phone's local database belongs to a
 * different Account, and with `null` when provisioning completed.
 */
async function provision(
  getToken: () => Promise<string | null>,
): Promise<PendingAccountReset | null> {
  const clerkToken = await getToken()
  if (!clerkToken) throw new Error('Clerk session token is unavailable')
  const appVersion = Constants.expoConfig?.version
  if (!appVersion) throw new Error('Installed app version is unavailable')
  const body = await exchangeDeviceToken({ serverUrl: SERVER_URL, clerkToken, appVersion })
  const state = await provisionDeviceCredential(SERVER_URL, body.deviceToken, body.accountId)
  if (!state.accountChangeRequiresReset) return null
  return { serverUrl: SERVER_URL, deviceToken: body.deviceToken, accountId: body.accountId }
}

function visibleError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/\s+/g, ' ').trim().slice(0, 160) || 'Unknown error'
}
