import { ActivityIndicator, StyleSheet, View } from 'react-native'
import type { SyncStatus } from 'vescape-core'

import { Text } from '@/components/base/Text'
import { ProgressBar } from '@/components/base/ProgressBar'
import { backupProgress, backupStatusCopy } from '@/modules/profile/lib/backupStatus'
import { useSyncStatusStore } from '@/modules/profile/store/syncStatusStore'

interface BackupStatusLineProps {
  /** Render a given status instead of the live one — the component showcase and previews. */
  status?: SyncStatus
  /** Backlog to measure `status` against; only meaningful alongside an injected status. */
  backlog?: number
}

/**
 * The backup state, as one line under the account identity. Native owns the state and the pause
 * reason; this only renders them.
 */
export function BackupStatusLine({ status, backlog }: BackupStatusLineProps) {
  const liveStatus = useSyncStatusStore((state) => state.status)
  const liveBacklog = useSyncStatusStore((state) => state.backlog)
  const shown = status ?? liveStatus
  const copy = backupStatusCopy(shown)
  // A bar belongs to work in flight; a waiting or paused backlog is not making progress.
  const progress = copy.busy
    ? backupProgress(shown.pendingRows, backlog ?? (status ? shown.pendingRows : liveBacklog))
    : null

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        {copy.busy ? (
          <ActivityIndicator size="small" color={copy.color} />
        ) : (
          <View style={[styles.dot, { backgroundColor: copy.color }]} />
        )}
        <Text numberOfLines={1} style={[styles.label, { color: copy.color }]}>
          {copy.label}
        </Text>
      </View>
      {progress ? (
        <ProgressBar current={progress.current} total={progress.total} color={copy.color} />
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    gap: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  label: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
  },
})
