import { useUser } from '@clerk/expo'
import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native'
import { ArrowClockwiseIcon, CaretRightIcon, UserCircleIcon } from 'phosphor-react-native'

import { Text } from '@/components/base/Text'
import { theme, type ThemeColor } from '@/constants/theme'
import { useColoredAction, useColoredActionForeground } from '@/hooks/useTheme'
import { useDeviceAuthStore } from '@/modules/profile/store/deviceAuthStore'
import { useRiderProfileStore } from '@/modules/profile/store/riderProfileStore'
import { routes } from '@/navigation/routes'

interface AccountPillProps {
  signInSize?: 'lg'
  onNavigate?: () => void
}

export function AccountPill({ onNavigate, signInSize }: AccountPillProps) {
  const router = useRouter()
  const { isLoaded, isSignedIn, user } = useUser()
  const deviceAuthStatus = useDeviceAuthStore((s) => s.status)
  const retryDeviceAuth = useDeviceAuthStore((s) => s.retry)
  const nick = useRiderProfileStore((s) => s.profile?.nick ?? null)

  const navigate = (route: typeof routes.signIn | typeof routes.account) => {
    onNavigate?.()
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
    return <AccountSignInPill size={signInSize} onPress={() => navigate(routes.signIn)} />
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

  const name = nick ?? user.fullName ?? user.primaryEmailAddress?.emailAddress ?? 'Vescape rider'

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

export function AccountSignInPill({
  size = 'sm',
  onPress,
}: {
  size?: 'sm' | 'lg'
  onPress: () => void
}) {
  const accent = theme.palette.groupRide.color
  const backgroundColor = useColoredAction(accent)
  const foreground = useColoredActionForeground(accent)
  const large = size === 'lg'

  return (
    <Pill
      onPress={onPress}
      style={large ? [styles.largePill, { backgroundColor, borderColor: foreground }] : undefined}
    >
      <UserCircleIcon
        size={large ? 22 : 18}
        color={large ? foreground : theme.settingsIcon.account}
        weight="duotone"
      />
      <Text style={[styles.label, large && { fontSize: 16, color: foreground }]} numberOfLines={1}>
        Sign in
      </Text>
      <CaretRightIcon
        size={large ? 16 : 13}
        color={large ? foreground : theme.control.textMuted}
        weight="bold"
      />
    </Pill>
  )
}

function Pill({
  tone,
  style,
  onPress,
  children,
}: {
  tone?: ThemeColor
  style?: StyleProp<ViewStyle>
  onPress: () => void
  children: React.ReactNode
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.pill,
        tone ? { borderColor: tone, backgroundColor: theme.status.error.bg } : null,
        style,
        pressed && { opacity: theme.interaction.pressedOpacity },
      ]}
      onPress={onPress}
      accessibilityRole="button"
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
    maxWidth: '100%',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.control.border,
    backgroundColor: theme.control.background,
  },
  largePill: { minHeight: 48 },
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
