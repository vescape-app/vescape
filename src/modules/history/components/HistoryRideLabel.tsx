import { StyleSheet, View } from 'react-native'

import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'

interface HistoryRideLabelProps {
  title: string
  subtitle: string
  details?: string
  compact?: boolean
}

/** Shared ride identity hierarchy for the history selector and its session list. */
export function HistoryRideLabel({
  title,
  subtitle,
  details,
  compact = false,
}: HistoryRideLabelProps) {
  return (
    <View style={[styles.content, compact && styles.contentCompact]}>
      <Text style={[styles.title, compact && styles.titleCompact]} numberOfLines={1}>
        {title}
      </Text>
      <Text style={[styles.subtitle, compact && styles.subtitleCompact]} numberOfLines={1}>
        {subtitle}
      </Text>
      {details ? (
        <Text style={styles.details} numberOfLines={1}>
          {details}
        </Text>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  content: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  contentCompact: {
    gap: 1,
  },
  title: {
    color: theme.palette.slate.textPrimary,
    fontSize: 15,
    fontWeight: '700',
  },
  titleCompact: {
    fontSize: 12,
    fontWeight: '800',
  },
  subtitle: {
    color: theme.palette.slate.textSecondary,
    fontSize: 12,
    fontWeight: '500',
  },
  subtitleCompact: {
    color: theme.palette.slate.textMuted,
    fontSize: 9,
    fontWeight: '600',
  },
  details: {
    color: theme.palette.slate.textMuted,
    fontSize: 11,
    fontWeight: '500',
  },
})
