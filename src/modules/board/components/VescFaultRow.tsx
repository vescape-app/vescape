import { StyleSheet, View } from 'react-native'
import { ArrowCounterClockwiseIcon, EyeSlashIcon } from 'phosphor-react-native'
import type { VescFaultOccurrence } from 'vescape-core'

import { Text } from '@/components/base/Text'
import { IconButton } from '@/components/base/IconButton'
import { faultTitle } from '@/modules/board/lib/vescFaults'
import { fmtTimeAgo } from '@/helpers/format'
import { theme } from '@/constants/theme'

interface VescFaultRowProps {
  fault: VescFaultOccurrence
  /** Toggle the occurrence-level dismissal. Never deletes the occurrence. */
  onSetDismissed: (id: string, dismissed: boolean) => void
}

/**
 * One row in the VESC Faults group: what the controller reported, when it happened, and whether it
 * is still active. Distinct from `BoardWarningRow` on purpose — a fault is the controller's own
 * evidence, not an app-authored finding, and it is dismissed per occurrence rather than per kind.
 *
 * A `live` occurrence knows when it happened. A register-sourced one does not, so it says
 * "Discovered" instead of inventing a precision the controller never gave.
 */
export function VescFaultRow({ fault, onSetDismissed }: VescFaultRowProps) {
  const dismissed = fault.dismissed
  const active = fault.clearedAtMs == null
  const title = faultTitle(fault.code)

  return (
    <View
      style={[
        styles.card,
        { borderColor: dismissed ? theme.neutral.border : theme.status.warning.border },
        dismissed && styles.cardDismissed,
      ]}
    >
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.title} numberOfLines={2}>
            {title}
          </Text>
          <View style={styles.chips}>
            <View style={[styles.chip, { backgroundColor: theme.neutral.surfaceDeep }]}>
              <Text style={[styles.chipText, { color: theme.neutral.textMuted }]}>
                Code {fault.code}
              </Text>
            </View>
            {active && (
              <View style={[styles.chip, { backgroundColor: theme.status.warning.bg }]}>
                <Text style={[styles.chipText, { color: theme.status.warning.text }]}>Active</Text>
              </View>
            )}
            {fault.source === 'baseline' && (
              <View style={[styles.chip, { backgroundColor: theme.neutral.surfaceDeep }]}>
                <Text style={[styles.chipText, { color: theme.neutral.textMuted }]}>
                  Pre-existing
                </Text>
              </View>
            )}
            {dismissed && (
              <View style={[styles.chip, { backgroundColor: theme.neutral.surfaceDeep }]}>
                <Text style={[styles.chipText, { color: theme.neutral.textMuted }]}>Dismissed</Text>
              </View>
            )}
          </View>
        </View>
        <IconButton
          icon={dismissed ? ArrowCounterClockwiseIcon : EyeSlashIcon}
          size="sm"
          onPress={() => onSetDismissed(fault.id, !dismissed)}
          accessibilityLabel={`${dismissed ? 'Restore' : 'Dismiss'} ${title}`}
        />
      </View>

      <Text style={styles.detected}>
        {fault.occurredAtMs != null
          ? `Occurred ${fmtTimeAgo(fault.occurredAtMs)}`
          : `Discovered ${fmtTimeAgo(fault.discoveredAtMs)} · occurrence time unknown`}
        {fault.clearedAtMs != null ? ` · cleared ${fmtTimeAgo(fault.clearedAtMs)}` : ''}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.neutral.surface,
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    gap: 10,
  },
  cardDismissed: {
    opacity: 0.55,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  headerText: {
    flex: 1,
    gap: 6,
  },
  title: {
    color: theme.neutral.textPrimary,
    fontSize: 15,
    fontWeight: '800',
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  chip: {
    alignSelf: 'flex-start',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  chipText: {
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  detected: {
    color: theme.neutral.textMuted,
    fontSize: 12,
  },
})
