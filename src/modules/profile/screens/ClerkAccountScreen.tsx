import { useAuth, useUser } from '@clerk/expo'
import { useNetworkState } from 'expo-network'
import { useRouter } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { ArrowLeftIcon, UserCircleIcon, WifiSlashIcon } from 'phosphor-react-native'
import { ConfirmModal } from '@/components/modals/ConfirmModal'

import { Button } from '@/components/base/Button'
import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'
import { SERVER_URL } from '@/config/server'
import { RiderNickForm } from '@/modules/profile/components/RiderNickForm'
import { deleteAccount } from '@/modules/profile/lib/deviceAuth'
import { stopAccountAndDelete, stopAccountAndSignOut } from '@/modules/profile/lib/accountTeardown'
import { useDeviceAuthStore } from '@/modules/profile/store/deviceAuthStore'
import { useRiderProfileStore } from '@/modules/profile/store/riderProfileStore'
import { routes } from '@/navigation/routes'
import { clearDeviceCredential, revokeDeviceCredential } from 'vescape-core'

const DELETE_ACCOUNT_MESSAGE = [
  'Permanently deleted: your Vescape account and sign-in email, your rider profile (your nick becomes available again), friends, stored public rides and your part of crew rides, monthly ride stats, cloud backups, and all map points and reactions you added to the map.',
  'Not affected: data on this phone. Boards, ride history, favorites with their photos and videos, tune profiles, alert rules, privacy zones, and app settings stay here.',
].join('\n\n')

export function ClerkAccountScreen() {
  const router = useRouter()
  const { getToken, isLoaded, isSignedIn, signOut } = useAuth({ treatPendingAsSignedOut: false })
  const { user } = useUser()
  const networkState = useNetworkState()
  const [signingOut, setSigningOut] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmSignOut, setConfirmSignOut] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [deletionAccepted, setDeletionAccepted] = useState(false)
  const deviceAuthStatus = useDeviceAuthStore((s) => s.status)
  const deviceAuthError = useDeviceAuthStore((s) => s.error)
  const retryDeviceAuth = useDeviceAuthStore((s) => s.retry)
  const profileLoaded = useRiderProfileStore((s) => s.loaded)
  const hasNick = useRiderProfileStore((s) => s.profile != null)
  const profileError = useRiderProfileStore((s) => s.error)

  const leaveAccount = useCallback(() => {
    if (router.canGoBack()) router.back()
    else router.replace(routes.home)
  }, [router])

  useEffect(() => {
    if (!isLoaded || isSignedIn) return
    leaveAccount()
  }, [isLoaded, isSignedIn, leaveAccount])

  const handleSignOut = useCallback(async () => {
    setSigningOut(true)
    setError(null)
    try {
      await stopAccountAndSignOut({ revokeCredential: revokeDeviceCredential, signOut })
    } catch {
      retryDeviceAuth()
      setError('Could not sign out. Check your connection and try again.')
    } finally {
      setSigningOut(false)
    }
  }, [retryDeviceAuth, signOut])

  const finishAccountDeletion = useCallback(async () => {
    try {
      useRiderProfileStore.getState().clear()
      await signOut()
    } catch {
      setDeleting(false)
      setDeleteError(
        'Your account was deleted, but this phone could not finish signing out. Try again.',
      )
    }
  }, [signOut])

  const handleDeleteAccount = useCallback(async () => {
    setDeleting(true)
    setDeleteError(null)
    if (deletionAccepted) {
      await finishAccountDeletion()
      return
    }
    const result = await stopAccountAndDelete({
      clearCredential: clearDeviceCredential,
      deleteAccount: async () => {
        const clerkToken = await getToken()
        if (!clerkToken) throw new Error('Clerk session token is unavailable')
        await deleteAccount({ serverUrl: SERVER_URL, clerkToken })
      },
    })
    if (result !== 'accepted') {
      retryDeviceAuth()
      setDeleting(false)
      setDeleteError(
        result === 'credential-clear-failed'
          ? 'Could not turn off account features on this phone. Try again.'
          : 'Could not delete your account. Check your connection and try again.',
      )
      return
    }
    setDeletionAccepted(true)
    await finishAccountDeletion()
  }, [deletionAccepted, finishAccountDeletion, getToken, retryDeviceAuth])

  if (!isLoaded || !isSignedIn) return null

  const offline = networkState.isInternetReachable === false
  const busy = signingOut || deleting

  return (
    <View style={styles.container}>
      {offline ? (
        <WifiSlashIcon size={40} color={theme.neutral.textMuted} weight="duotone" />
      ) : (
        <UserCircleIcon size={48} color={theme.neutral.textMuted} weight="duotone" />
      )}
      <Text style={styles.title}>{user?.fullName ?? 'Vescape account'}</Text>
      <Text style={styles.detail}>{user?.primaryEmailAddress?.emailAddress ?? 'Signed in'}</Text>
      {profileLoaded ? (
        <RiderNickForm title={hasNick ? 'Your nick' : 'Pick a nick to ride under'} />
      ) : profileError ? (
        <Text style={styles.error}>{profileError}</Text>
      ) : null}
      {offline && (
        <Text style={styles.message}>
          Signing out and deleting your account need internet so the server can revoke this phone’s
          native credential first.
        </Text>
      )}
      {deviceAuthStatus === 'failed' && (
        <>
          <Text style={styles.error}>
            Account not connected on this phone{deviceAuthError ? `: ${deviceAuthError}` : '.'}
          </Text>
          <Button label="Retry connection" variant="secondary" onPress={retryDeviceAuth} />
        </>
      )}
      {error && <Text style={styles.error}>{error}</Text>}
      <View style={styles.actions}>
        <Button label="Go back" variant="primary" icon={ArrowLeftIcon} onPress={leaveAccount} />
        <DestructiveAction
          label={signingOut ? 'Signing out…' : 'Sign out'}
          disabled={busy || offline}
          onPress={() => setConfirmSignOut(true)}
        />
        <DestructiveAction
          label={deleting ? 'Deleting account…' : 'Delete account'}
          disabled={busy || offline}
          onPress={() => {
            setDeleteError(null)
            setConfirmDelete(true)
          }}
        />
      </View>
      <ConfirmModal
        visible={confirmSignOut}
        title="Sign out?"
        message="Public rides and friends stop until you sign in again."
        confirmLabel="Sign out"
        destructive
        onConfirm={() => {
          setConfirmSignOut(false)
          void handleSignOut()
        }}
        onCancel={() => setConfirmSignOut(false)}
      />
      <ConfirmModal
        visible={confirmDelete}
        title="Delete your Vescape account?"
        message={DELETE_ACCOUNT_MESSAGE}
        confirmLabel={deletionAccepted ? 'Finish signing out' : 'Delete account'}
        destructive
        loading={deleting}
        error={deleteError}
        onConfirm={handleDeleteAccount}
        onCancel={() => setConfirmDelete(false)}
      />
    </View>
  )
}

function DestructiveAction({
  label,
  disabled,
  onPress,
}: {
  label: string
  disabled: boolean
  onPress: () => void
}) {
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      style={({ pressed }) => [
        disabled && styles.disabled,
        pressed && { opacity: theme.interaction.pressedOpacity },
      ]}
    >
      <Text style={styles.destructive}>{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 32,
    backgroundColor: theme.neutral.bg,
  },
  title: {
    color: theme.neutral.textPrimary,
    fontSize: 18,
    fontWeight: '700',
  },
  detail: {
    color: theme.neutral.textSecondary,
    fontSize: 13,
  },
  message: {
    color: theme.neutral.textSecondary,
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
  },
  error: {
    color: theme.status.error.text,
    fontSize: 13,
    textAlign: 'center',
  },
  actions: {
    alignItems: 'center',
    gap: 28,
    marginTop: 12,
  },
  destructive: {
    color: theme.status.error.text,
    fontSize: 14,
    fontWeight: '600',
  },
  disabled: {
    opacity: 0.4,
  },
})
