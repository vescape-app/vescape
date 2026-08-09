import { WarningIcon } from 'phosphor-react-native'
import type { ReactNode } from 'react'
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
  sideActions,
  notice,
  profileSelector,
  media,
  targetColor,
  targetTextColor,
  onDismiss,
  onFocusTarget,
}: {
  target: MapSelection
  bottom: number
  /** Confirming the path and leaving the map for the ride view. The rider's likely next move. */
  action: MapTargetSheetAction
  /** Flanking the confirm at lesser weight: asking for the path again, and dropping it. */
  sideActions?: readonly MapTargetSheetAction[]
  /** Why there is no line, in rider-facing words. */
  notice?: string | null
  /** Which kind of ways the path may follow. Sits on the path view, never in app settings. */
  profileSelector?: ReactNode
  media: readonly MapPointMediaAsset[]
  /** The Direction Point's own colour, for the header badge — the actions carry their own. */
  targetColor: string
  targetTextColor: string
  onDismiss?: () => void
  onFocusTarget?: () => void
}) {
  return (
    <MapTargetSheetFrame
      target={target}
      bottom={bottom}
      header={<MapTargetReadHeader target={target} />}
      fallbackColor={targetColor}
      fallbackTextColor={targetTextColor}
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
      {profileSelector ? <View style={styles.profileRow}>{profileSelector}</View> : null}
      <MapTargetActionRow>
        {sideActions?.slice(0, 1).map((sideAction) => (
          <MapTargetPrimaryAction key={sideAction.label} action={sideAction} compact />
        ))}
        <MapTargetPrimaryAction action={action} />
        {sideActions?.slice(1).map((sideAction) => (
          <MapTargetPrimaryAction key={sideAction.label} action={sideAction} compact />
        ))}
      </MapTargetActionRow>
    </MapTargetSheetFrame>
  )
}

const styles = StyleSheet.create({
  profileRow: {
    flexDirection: 'row',
  },
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
