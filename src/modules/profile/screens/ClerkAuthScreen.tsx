import { useSession } from '@clerk/expo'
import { AuthView } from '@clerk/expo/native'
import { useRouter } from 'expo-router'
import { useCallback, useEffect, useRef } from 'react'
import { Platform, StyleSheet, View } from 'react-native'

import { theme } from '@/constants/theme'
import { routes } from '@/navigation/routes'

export function ClerkAuthScreen() {
  const router = useRouter()
  const { session } = useSession()
  const didLeaveAuth = useRef(false)

  const leaveAuth = useCallback(() => {
    if (didLeaveAuth.current) return
    didLeaveAuth.current = true

    if (router.canGoBack()) router.back()
    else router.replace(routes.profileStats)
  }, [router])

  useEffect(() => {
    if (session?.status === 'active') leaveAuth()
  }, [leaveAuth, session?.status])

  return (
    <View style={styles.container}>
      <AuthView mode="signInOrUp" isDismissible={Platform.OS === 'ios'} onDismiss={leaveAuth} />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.neutral.bg,
  },
})
