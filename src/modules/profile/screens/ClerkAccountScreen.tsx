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
import {
  resumeDeviceProvisioning,
  suspendDeviceProvisioning,
} from '@/modules/profile/lib/deviceProvisioning'
import { useDeviceAuthStore } from '@/modules/profile/store/deviceAuthStore'
import { useRiderProfileStore } from '@/modules/profile/store/riderProfileStore'
import { routes } from '@/navigation/routes'
import { clearDeviceCredential, revokeDeviceCredential } from 'vescape-core'

const DELETE_ACCOUNT_MESSAGE = [
  'Permanently deleted: your Vescape account and sign-in email, your rider profile (your nick becomes available again), friends, stored public rides and your part of crew rides, monthly ride stats, cloud backups, and all map points and reactions you added to the map.',
  'Not affected: data on this phone. Boards, ride history, favorites, tune profiles, alert rules, privacy zones, and app settings stay here.',
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
  const retryDeviceAuth = useDeviceAuthStore((s) => s.retry)
  const profileLoaded = useRiderProfileStore((s) => s.loaded)
  const hasNick = useRiderProfileStore((s) => s.profile != null)
  const profileError = useRiderProfileStore((s) => s.error)

  const leaveAccount = useCallback(() => {
    if (router.canGoBack()) router.back()
    else router.replace(routes.profileStats)
  }, [router])

  useEffect(() => {
    if (!isLoaded || isSignedIn) return
    router.replace(routes.profileStats)
  }, [isLoaded, isSignedIn, router])

  const handleSignOut = useCallback(async () => {
    setSigningOut(true)
    setError(null)
    try {
      await revokeDeviceCredential()
      await signOut()
    } catch {
      setError('Could not sign out. Check your connection and try again.')
    } finally {
      setSigningOut(false)
    }
  }, [signOut])

  const handleDeleteAccount = useCallback(async () => {
    setDeleting(true)
    setDeleteError(null)
    await suspendDeviceProvisioning()
    try {
      const clerkToken = await getToken()
      if (!clerkToken) throw new Error('Clerk session token is unavailable')
      await deleteAccount({ serverUrl: SERVER_URL, clerkToken })
    } catch {
      resumeDeviceProvisioning()
      retryDeviceAuth()
      setDeleting(false)
      setDeleteError('Could not delete your account. Check your connection and try again.')
      return
    }
    try {
      clearDeviceCredential()
    } catch {
      // intentional-suppression: the server already revoked every Device Token, so a stale local one is rejected on next use
    }
    useRiderProfileStore.getState().clear()
    try {
      await signOut()
    } catch {
      router.replace(routes.profileStats)
    } finally {
      resumeDeviceProvisioning()
    }
  }, [getToken, retryDeviceAuth, router, signOut])

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
        confirmLabel="Delete account"
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
