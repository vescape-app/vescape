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
import { RiderNickForm } from '@/modules/profile/components/RiderNickForm'
import { useRiderProfileStore } from '@/modules/profile/store/riderProfileStore'
import { routes } from '@/navigation/routes'
import { revokeDeviceCredential } from 'vescape-core'

export function ClerkAccountScreen() {
  const router = useRouter()
  const { isLoaded, isSignedIn, signOut } = useAuth({ treatPendingAsSignedOut: false })
  const { user } = useUser()
  const networkState = useNetworkState()
  const [signingOut, setSigningOut] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmSignOut, setConfirmSignOut] = useState(false)
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
      // Security invariant: clearing Clerk first would strand a live Device Token.
      await revokeDeviceCredential()
      await signOut()
    } catch {
      setError('Could not sign out. Check your connection and try again.')
    } finally {
      setSigningOut(false)
    }
  }, [signOut])

  if (!isLoaded || !isSignedIn) return null

  return (
    <View style={styles.container}>
      {networkState.isInternetReachable === false ? (
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
      {networkState.isInternetReachable === false && (
        <Text style={styles.message}>
          Signing out needs internet so this phone’s native credential can be revoked first.
        </Text>
      )}
      {error && <Text style={styles.error}>{error}</Text>}
      <View style={styles.actions}>
        <Button label="Go back" variant="primary" icon={ArrowLeftIcon} onPress={leaveAccount} />
        <Pressable
          disabled={signingOut || networkState.isInternetReachable === false}
          onPress={() => setConfirmSignOut(true)}
          hitSlop={8}
          accessibilityRole="button"
          style={({ pressed }) => [
            networkState.isInternetReachable === false && styles.disabled,
            pressed && { opacity: theme.interaction.pressedOpacity },
          ]}
        >
          <Text style={styles.signOut}>{signingOut ? 'Signing out…' : 'Sign out'}</Text>
        </Pressable>
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
    </View>
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
  signOut: {
    color: theme.status.error.text,
    fontSize: 14,
    fontWeight: '600',
  },
  disabled: {
    opacity: 0.4,
  },
})
