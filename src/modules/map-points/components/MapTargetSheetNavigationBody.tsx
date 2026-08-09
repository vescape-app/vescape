import { WarningIcon } from 'phosphor-react-native'
import { StyleSheet, View } from 'react-native'

import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'
import type { MapTargetSheetAction } from '@/modules/map-points/components/mapTargetSheetChrome'
import {
  MapPointDetails,
  MapTargetActionRow,
  MapTargetPrimaryAction,
  MapTargetReadHeader,
  MapTargetSheetFrame,
} from '@/modules/map-points/components/mapTargetSheetChrome'
import type { MapPointMediaAsset } from '@/modules/map-points/store/mapPointPhotoFiles'
import type { MapSelection } from '@/modules/map/lib/mapSelection'

export function MapTargetNavigationBody({
  target,
  bottom,
  action,
  secondaryAction,
  notice,
  media,
  onDismiss,
  onFocusTarget,
}: {
  target: MapSelection
  bottom: number
  action: MapTargetSheetAction
  /** Shown beside the primary action. Used when a failed path offers a retry next to the cancel. */
  secondaryAction?: MapTargetSheetAction
  /** Why there is no line, in rider-facing words. */
  notice?: string | null
  media: readonly MapPointMediaAsset[]
  onDismiss?: () => void
  onFocusTarget?: () => void
}) {
  return (
    <MapTargetSheetFrame
      target={target}
      bottom={bottom}
      header={<MapTargetReadHeader target={target} />}
      fallbackColor={action.color}
      fallbackTextColor={action.textColor}
      onDismiss={onDismiss}
      onFocusTarget={onFocusTarget}
    >
      {target.type === 'mapPoint' ? <MapPointDetails point={target.point} media={media} /> : null}
      {notice ? (
        <View style={styles.notice}>
          <WarningIcon size={16} color={theme.status.warning.text} weight="bold" />
          <Text style={styles.noticeText}>{notice}</Text>
        </View>
      ) : null}
      <MapTargetActionRow>
        <MapTargetPrimaryAction action={action} />
        {secondaryAction ? <MapTargetPrimaryAction action={secondaryAction} /> : null}
      </MapTargetActionRow>
    </MapTargetSheetFrame>
  )
}

const styles = StyleSheet.create({
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingRight: 36,
  },
  noticeText: {
    flexShrink: 1,
    color: theme.status.warning.text,
    fontSize: 12,
    fontWeight: '700',
  },
})
