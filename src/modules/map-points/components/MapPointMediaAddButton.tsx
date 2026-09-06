import { CameraIcon, PlusIcon, VideoCameraIcon } from 'phosphor-react-native'
import { StyleSheet, View } from 'react-native'

import { Button } from '@/components/base/Button'
import { IconButton } from '@/components/base/IconButton'
import { theme } from '@/constants/theme'

export function MapPointMediaActions({
  loading,
  onAdd,
  onCapturePhoto,
  onCaptureVideo,
}: {
  loading: boolean
  onAdd: () => void
  onCapturePhoto: () => void
  onCaptureVideo: () => void
}) {
  return (
    <View style={styles.row}>
      <Button
        label="Add Photos & Videos"
        icon={PlusIcon}
        variant="secondary"
        loading={loading}
        onPress={onAdd}
        style={styles.addButton}
      />
      <IconButton
        icon={CameraIcon}
        loading={loading}
        onPress={onCapturePhoto}
        accessibilityLabel="Take photo"
        style={styles.iconButton}
      />
      <IconButton
        icon={VideoCameraIcon}
        loading={loading}
        onPress={onCaptureVideo}
        accessibilityLabel="Record video"
        style={styles.iconButton}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  addButton: {
    flex: 1,
    minWidth: 0,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: theme.neutral.surface,
    borderColor: theme.neutral.border,
  },
})
