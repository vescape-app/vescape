import { useAuth, useUser } from '@clerk/expo'
import { useNetworkState } from 'expo-network'
import { useRouter } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { UserCircleIcon, WifiSlashIcon } from 'phosphor-react-native'

import { Button } from '@/components/base/Button'
import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'
import { routes } from '@/navigation/routes'
import { revokeDeviceCredential } from 'vescape-core'

export function ClerkAccountScreen() {
  const router = useRouter()
  const { isLoaded, isSignedIn, signOut } = useAuth({ treatPendingAsSignedOut: false })
  const { user } = useUser()
  const networkState = useNetworkState()
  const [signingOut, setSigningOut] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
      {networkState.isInternetReachable === false && (
        <Text style={styles.message}>
          Signing out needs internet so this phone’s native credential can be revoked first.
        </Text>
      )}
      {error && <Text style={styles.error}>{error}</Text>}
      <View style={styles.actions}>
        <Button label="Go back" variant="secondary" onPress={leaveAccount} />
        <Button
          label="Sign out"
          variant="destructive"
          loading={signingOut}
          disabled={networkState.isInternetReachable === false}
          onPress={() => void handleSignOut()}
        />
      </View>
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
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
})
