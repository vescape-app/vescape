import { StyleSheet, View } from 'react-native'

import { Banner } from '@/components/base/Banner'
import { theme } from '@/constants/theme'
import { useBleStore } from '@/modules/board/store/bleStore'

export function RecordingStorageFailureBanner({ top }: { top: number }) {
  const failure = useBleStore((state) => state.recordingFailure)
  if (!failure) return null

  const message =
    failure.kind === 'full_disk'
      ? 'Recording stopped. Free storage, then restart Vescape.'
      : failure.storageUnavailable
        ? 'App storage is unavailable. Restart Vescape before using storage features.'
        : 'Recording stopped because it could not be saved. Restart Vescape before recording again.'

  return (
    <View pointerEvents="none" style={[styles.container, { top }]} testID="storage-failure-banner">
      <Banner variant="error" title="App Storage Failure" message={message} />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 12,
    right: 12,
    zIndex: 200,
    padding: 12,
    borderRadius: 8,
    backgroundColor: theme.neutral.surface,
  },
})
