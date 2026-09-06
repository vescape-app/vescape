import { PencilSimpleIcon, PlusIcon, ThumbsDownIcon, ThumbsUpIcon } from 'phosphor-react-native'
import { Pressable, StyleSheet, View } from 'react-native'

import { IconButton } from '@/components/base/IconButton'
import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'
import { useColoredAction, useResolvedAccentColors } from '@/hooks/useTheme'
import {
  MapPointDetails,
  MapTargetActionRow,
  type MapTargetSheetAction,
  MapTargetPrimaryAction,
  MapTargetReadHeader,
  MapTargetSheetFrame,
} from '@/modules/map-points/components/mapTargetSheetChrome'
import { mapSheetStyles } from '@/modules/map-points/components/mapSheetStyles'
import type { MapPointMediaAsset } from '@/modules/map-points/store/mapPointPhotoFiles'
import type { MapSelection } from '@/modules/map/lib/mapSelection'

export function MapTargetSelectBody({
  target,
  bottom,
  action,
  media,
  onAddFeature,
  onEdit,
  onVoteMapPoint,
  onDismiss,
  onFocusTarget,
}: {
  target: MapSelection
  bottom: number
  action: MapTargetSheetAction
  media: readonly MapPointMediaAsset[]
  onAddFeature?: () => void
  onEdit?: () => void
  onVoteMapPoint?: (id: string, reaction: 'up' | 'down' | null) => boolean
  onDismiss?: () => void
  onFocusTarget?: () => void
}) {
  const accents = useResolvedAccentColors()
  const point = target.type === 'mapPoint' ? target.point : null

  return (
    <MapTargetSheetFrame
      target={target}
      bottom={bottom}
      header={<MapTargetReadHeader target={target} />}
      fallbackColor={action.color}
      fallbackTextColor={action.color}
      onDismiss={onDismiss}
      onFocusTarget={onFocusTarget}
    >
      {point ? <MapPointDetails point={point} media={media} /> : null}
      <MapTargetActionRow>
        {point && onEdit ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Edit map feature"
            onPress={onEdit}
            style={({ pressed }) => [
              styles.editButton,
              pressed && mapSheetStyles.mapTargetNavigatePressed,
            ]}
          >
            <PencilSimpleIcon size={18} color={theme.neutral.textPrimary} weight="bold" />
            <Text style={[mapSheetStyles.mapTargetNavigateText, styles.editText]}>Edit</Text>
          </Pressable>
        ) : null}
        {point && onVoteMapPoint ? (
          <MapPointVoteButtons point={point} onVote={onVoteMapPoint} />
        ) : null}
        <MapTargetPrimaryAction action={action} />
        {!point && onAddFeature ? (
          <IconButton
            icon={PlusIcon}
            size="md"
            onPress={onAddFeature}
            accent={accents.cyan.light}
            accessibilityLabel="Add map feature here"
          />
        ) : null}
      </MapTargetActionRow>
    </MapTargetSheetFrame>
  )
}

function MapPointVoteButtons({
  point,
  onVote,
}: {
  point: Extract<MapSelection, { type: 'mapPoint' }>['point']
  onVote: (id: string, reaction: 'up' | 'down' | null) => boolean
}) {
  const reaction = point.myReaction
  // Active vote buttons wear the two-layer colored surface of their colour.
  const upSurface = useColoredAction(theme.palette.cyan.color)
  const downSurface = useColoredAction(theme.palette.red.color)
  return (
    <View style={styles.voteGroup}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Vote map feature up"
        onPress={() => onVote(point.id, reaction === 'up' ? null : 'up')}
        style={({ pressed }) => [
          styles.voteButton,
          reaction === 'up' && {
            borderColor: theme.palette.cyan.color,
            backgroundColor: upSurface,
          },
          pressed && mapSheetStyles.mapTargetNavigatePressed,
        ]}
      >
        <ThumbsUpIcon
          size={18}
          color={reaction === 'up' ? theme.palette.cyan.light : theme.neutral.textPrimary}
          weight={reaction === 'up' ? 'fill' : 'bold'}
        />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Vote map feature down"
        onPress={() => onVote(point.id, reaction === 'down' ? null : 'down')}
        style={({ pressed }) => [
          styles.voteButton,
          reaction === 'down' && {
            borderColor: theme.palette.red.color,
            backgroundColor: downSurface,
          },
          pressed && mapSheetStyles.mapTargetNavigatePressed,
        ]}
      >
        <ThumbsDownIcon
          size={18}
          color={reaction === 'down' ? theme.palette.red.light : theme.neutral.textPrimary}
          weight={reaction === 'down' ? 'fill' : 'bold'}
        />
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  editButton: {
    minWidth: 88,
    height: 46,
    paddingHorizontal: 14,
    borderRadius: 23,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    borderWidth: 1,
    borderColor: theme.alpha(theme.palette.slate.light, 0.3),
    backgroundColor: theme.alpha(theme.neutral.bg, 0.75),
  },
  editText: {
    color: theme.neutral.textPrimary,
  },
  voteButton: {
    width: 46,
    height: 46,
    paddingHorizontal: 0,
    borderRadius: 23,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.alpha(theme.palette.slate.light, 0.3),
    backgroundColor: theme.alpha(theme.neutral.bg, 0.75),
  },
  voteGroup: {
    flexDirection: 'row',
    gap: 4,
  },
})
