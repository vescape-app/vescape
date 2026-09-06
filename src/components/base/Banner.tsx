import { StyleSheet, View } from 'react-native'
import { Text } from '@/components/base/Text'
import { InfoIcon, WarningIcon, WarningCircleIcon } from 'phosphor-react-native'

import { theme } from '@/constants/theme'

type Variant = 'info' | 'warning' | 'error'

interface BannerProps {
  variant?: Variant
  title?: string
  message: string
}

const config = {
  info: {
    accent: theme.banner.info.icon,
    Icon: InfoIcon,
  },
  warning: {
    accent: theme.banner.warning.icon,
    Icon: WarningIcon,
  },
  error: {
    accent: theme.banner.error.icon,
    Icon: WarningCircleIcon,
  },
} satisfies Record<Variant, object>

export function Banner({ variant = 'info', title, message }: BannerProps) {
  const { accent, Icon } = config[variant]

  return (
    <View style={styles.container}>
      <View style={[styles.accent, { backgroundColor: accent }]} />
      <Icon size={18} color={accent} weight="duotone" style={styles.icon} />
      <View style={styles.body}>
        {title ? <Text style={styles.title}>{title}</Text> : null}
        <Text style={styles.message}>{message}</Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
    paddingLeft: 14,
  },
  accent: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 2,
    borderRadius: 1,
  },
  icon: {
    marginTop: 1,
  },
  body: {
    flex: 1,
    gap: 3,
  },
  title: {
    fontSize: 14,
    fontWeight: '700',
    color: theme.neutral.textPrimary,
  },
  message: {
    fontSize: 13,
    fontWeight: '500',
    lineHeight: 19,
    color: theme.neutral.textSecondary,
  },
})
