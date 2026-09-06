import { useUser } from '@clerk/expo'
import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native'
import { ArrowClockwiseIcon, CaretRightIcon, UserCircleIcon } from 'phosphor-react-native'

import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'
import { useDeviceAuthStore } from '@/modules/profile/store/deviceAuthStore'
import { routes } from '@/navigation/routes'

interface AccountPillProps {
  /** Called before navigating away so the host can dismiss its sheet. */
  onNavigate: () => void
}

/**
 * The Vescape Account as one compact pill: sign in, or who you are signed in as.
 *
 * Credential provisioning is part of the identity, not a separate widget — a failed Clerk →
 * Device Token exchange turns the pill into a retry button, because until it succeeds the account
 * buys the Rider nothing.
 */
export function AccountPill({ onNavigate }: AccountPillProps) {
  const router = useRouter()
  const { isLoaded, isSignedIn, user } = useUser()
  const deviceAuthStatus = useDeviceAuthStore((s) => s.status)
  const retryDeviceAuth = useDeviceAuthStore((s) => s.retry)

  const navigate = (route: typeof routes.signIn | typeof routes.account) => {
    onNavigate()
    router.push(route)
  }

  if (!isLoaded) {
    return (
      <View style={styles.pill}>
        <ActivityIndicator size="small" color={theme.settingsIcon.account} />
        <Text style={styles.label}>Checking account…</Text>
      </View>
    )
  }

  if (!isSignedIn) {
    return (
      <Pill onPress={() => navigate(routes.signIn)}>
        <UserCircleIcon size={18} color={theme.settingsIcon.account} weight="duotone" />
        <Text style={styles.label}>Sign in</Text>
        <CaretRightIcon size={13} color={theme.control.textMuted} weight="bold" />
      </Pill>
    )
  }

  if (deviceAuthStatus === 'failed') {
    return (
      <Pill tone={theme.status.error.color} onPress={retryDeviceAuth}>
        <ArrowClockwiseIcon size={18} color={theme.status.error.text} weight="bold" />
        <Text style={[styles.label, { color: theme.status.error.text }]}>
          Account not connected — retry
        </Text>
      </Pill>
    )
  }

  const name = user.fullName ?? user.primaryEmailAddress?.emailAddress ?? 'Vescape rider'

  return (
    <Pill onPress={() => navigate(routes.account)}>
      {user.imageUrl ? (
        <Image source={user.imageUrl} style={styles.avatar} contentFit="cover" />
      ) : (
        <UserCircleIcon size={18} color={theme.settingsIcon.account} weight="duotone" />
      )}
      <Text style={styles.label} numberOfLines={1}>
        {name}
      </Text>
      {deviceAuthStatus === 'provisioning' ? (
        <ActivityIndicator size="small" color={theme.settingsIcon.account} />
      ) : (
        <CaretRightIcon size={13} color={theme.control.textMuted} weight="bold" />
      )}
    </Pill>
  )
}

function Pill({
  tone,
  onPress,
  children,
}: {
  tone?: string
  onPress: () => void
  children: React.ReactNode
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.pill,
        tone ? { borderColor: tone, backgroundColor: theme.status.error.bg } : null,
        pressed && { opacity: theme.interaction.pressedOpacity },
      ]}
      onPress={onPress}
      testID="account-pill"
    >
      {children}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    maxWidth: '90%',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.control.border,
    backgroundColor: theme.control.background,
  },
  avatar: {
    width: 22,
    height: 22,
    borderRadius: 11,
  },
  label: {
    flexShrink: 1,
    color: theme.control.text,
    fontSize: 13,
    fontWeight: '700',
  },
})
