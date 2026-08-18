import { StyleSheet, View } from 'react-native'

import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'

export interface ProgressBarProps {
  /** Units finished so far. */
  current: number
  /** Units the run started with. A total of zero draws an empty track and no readout. */
  total: number
  color?: string
}

/**
 * Determinate progress for work the Rider is waiting on: a rebuild, a backup drain. The counts are
 * the contract, and the bar owns how they read — every place that shows progress shows it the same.
 */
export function ProgressBar({
  current,
  total,
  color = theme.status.warning.color,
}: ProgressBarProps) {
  const fraction = total > 0 ? Math.min(1, Math.max(0, current / total)) : 0

  return (
    <View style={styles.row}>
      <View style={styles.track}>
        <View
          style={[styles.fill, { width: `${Math.round(fraction * 100)}%`, backgroundColor: color }]}
        />
      </View>
      {total > 0 ? (
        <Text style={styles.label}>
          {current}/{total}
        </Text>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  track: {
    flex: 1,
    height: 3,
    backgroundColor: theme.palette.slate.surfaceDeep,
    borderRadius: 999,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
  },
  label: {
    minWidth: 44,
    color: theme.palette.slate.textMuted,
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'right',
  },
})
