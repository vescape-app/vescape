import { TrashIcon } from 'phosphor-react-native'
import { useCallback, useState } from 'react'
import { Pressable, StyleSheet, TextInput, View } from 'react-native'
import type { MapPoint, MapPointPatch } from 'vescape-core'

import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'
import { useColoredAction } from '@/hooks/useTheme'
import { useKeyboardLift } from '@/hooks/useKeyboardLift'
import { MapPointMediaActions } from '@/modules/map-points/components/MapPointMediaAddButton'
import { MapPointMediaPreview } from '@/modules/map-points/components/MapPointMediaPreview'
import {
  MapTargetActionRow,
  MapTargetEditHeader,
  MapTargetSheetFrame,
  mapTargetSheetChromeStyles,
} from '@/modules/map-points/components/mapTargetSheetChrome'
import { mapSheetStyles } from '@/modules/map-points/components/mapSheetStyles'
import { MAP_POINT_MEDIA_ENABLED } from '@/modules/map-points/constants/mapPoints'
import type { MapPointMediaController } from '@/modules/map-points/hooks/useMapPointMedia'
import type { MapSelection } from '@/modules/map/lib/mapSelection'

export function MapTargetEditBody({
  target,
  bottom,
  media,
  onSave,
  onSaveMapPoint,
  onDelete,
  onDismiss,
  onFocusTarget,
}: {
  target: Extract<MapSelection, { type: 'mapPoint' }>
  bottom: number
  media: MapPointMediaController
  onSave?: () => void
  onSaveMapPoint?: (id: string, patch: MapPointPatch) => Promise<MapPoint | null>
  onDelete?: () => void
  onDismiss?: () => void
  onFocusTarget?: () => void
}) {
  const point = target.point
  const [name, setName] = useState(point.name ?? '')
  const [description, setDescription] = useState(point.description ?? '')
  const keyboardLift = useKeyboardLift(true)
  const sheetBottom = Math.max(bottom, keyboardLift + 12)
  // Colored actions wear the two-layer colored surface.
  const deleteSurface = useColoredAction(theme.palette.red.color)
  const saveSurface = useColoredAction(theme.palette.cyan.color)
  const handleSave = useCallback(async () => {
    if (onSaveMapPoint) await onSaveMapPoint(point.id, { name, description })
    onSave?.()
  }, [description, name, onSave, onSaveMapPoint, point.id])

  return (
    <MapTargetSheetFrame
      target={target}
      bottom={sheetBottom}
      header={<MapTargetEditHeader point={point} name={name} onChangeName={setName} />}
      onDismiss={onDismiss}
      onFocusTarget={onFocusTarget}
    >
      <View style={styles.draftFields}>
        <TextInput
          value={description}
          onChangeText={setDescription}
          placeholder="Description"
          placeholderTextColor={theme.neutral.textMuted}
          multiline
          style={[mapTargetSheetChromeStyles.input, styles.descriptionInput]}
          accessibilityLabel="Map feature description"
        />
        {MAP_POINT_MEDIA_ENABLED ? (
          <View style={mapTargetSheetChromeStyles.mediaBox}>
            <MapPointMediaPreview assets={media.assets} onRemove={media.remove} />
            <MapPointMediaActions
              loading={media.saving}
              onAdd={() => void media.pick()}
              onCapturePhoto={() => void media.capture(['images'])}
              onCaptureVideo={() => void media.capture(['videos'])}
            />
          </View>
        ) : null}
      </View>
      <MapTargetActionRow>
        {onDelete ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Delete map feature"
            onPress={onDelete}
            style={({ pressed }) => [
              styles.deleteIconButton,
              { backgroundColor: deleteSurface, borderColor: theme.palette.red.color },
              pressed && mapSheetStyles.mapTargetNavigatePressed,
            ]}
          >
            <TrashIcon size={18} color={theme.palette.red.light} weight="bold" />
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Save map feature"
          onPress={() => void handleSave()}
          style={({ pressed }) => [
            mapTargetSheetChromeStyles.actionButton,
            mapTargetSheetChromeStyles.actionButtonLead,
            { backgroundColor: saveSurface, borderColor: theme.palette.cyan.color },
            pressed && mapSheetStyles.mapTargetNavigatePressed,
          ]}
        >
          <Text style={[mapSheetStyles.mapTargetNavigateText, { color: theme.palette.cyan.light }]}>
            Save
          </Text>
        </Pressable>
      </MapTargetActionRow>
    </MapTargetSheetFrame>
  )
}

const styles = StyleSheet.create({
  deleteIconButton: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  descriptionInput: {
    minHeight: 72,
    paddingTop: 10,
    textAlignVertical: 'top',
  },
  draftFields: {
    gap: 8,
  },
})
