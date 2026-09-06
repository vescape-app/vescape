import { StyleSheet, View } from 'react-native'

import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'

interface HistoryRideLabelProps {
  title: string
  subtitle: string
  details?: string
  compact?: boolean
  tone?: 'default' | 'control'
}

/** Shared ride identity hierarchy for the history selector and its session list. */
export function HistoryRideLabel({
  title,
  subtitle,
  details,
  compact = false,
  tone = 'default',
}: HistoryRideLabelProps) {
  return (
    <View style={[styles.content, compact && styles.contentCompact]}>
      <Text
        style={[
          styles.title,
          compact && styles.titleCompact,
          tone === 'control' && styles.titleControl,
        ]}
        numberOfLines={1}
      >
        {title}
      </Text>
      <Text
        style={[
          styles.subtitle,
          compact && styles.subtitleCompact,
          tone === 'control' && styles.subtitleControl,
        ]}
        numberOfLines={1}
      >
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
    color: theme.neutral.textPrimary,
    fontSize: 15,
    fontWeight: '700',
  },
  titleCompact: {
    fontSize: 12,
    fontWeight: '800',
  },
  titleControl: {
    color: theme.control.text,
  },
  subtitle: {
    color: theme.neutral.textSecondary,
    fontSize: 12,
    fontWeight: '500',
  },
  subtitleCompact: {
    color: theme.neutral.textMuted,
    fontSize: 9,
    fontWeight: '600',
  },
  subtitleControl: {
    color: theme.control.textMuted,
  },
  details: {
    color: theme.neutral.textMuted,
    fontSize: 11,
    fontWeight: '500',
  },
})
