import { PathIcon, TimerIcon, WarningIcon } from 'phosphor-react-native'
import type { ReactNode } from 'react'
import { ActivityIndicator, StyleSheet, View } from 'react-native'

import { useFormat } from '@/hooks/useFormat'
import { Text } from '@/components/base/Text'
import { theme, type ThemeColor } from '@/constants/theme'
import { fmtRideDuration } from '@/helpers/format'
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
  path,
  computing = false,
  profileSelector,
  media,
  targetColor,
  targetTextColor,
  onDismiss,
  onFocusTarget,
}: {
  target: MapSelection
  bottom: number
  action: MapTargetSheetAction
  sideActions?: readonly MapTargetSheetAction[]
  notice?: string | null
  path?: { distanceMeters: number; durationSeconds: number } | null
  computing?: boolean
  profileSelector?: ReactNode
  media: readonly MapPointMediaAsset[]
  targetColor: ThemeColor
  targetTextColor: ThemeColor
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
      animateEntrance
    >
      {target.type === 'mapPoint' ? <MapPointDetails point={target.point} media={media} /> : null}
      <PathFacts computing={computing} notice={notice} path={path} />
      {profileSelector ? <View style={styles.profileRow}>{profileSelector}</View> : null}
      <MapTargetActionRow>
        {sideActions?.slice(0, 1).map((sideAction) => (
          <MapTargetPrimaryAction key={sideAction.label} action={sideAction} compact iconOnly />
        ))}
        <MapTargetPrimaryAction action={action} />
        {sideActions?.slice(1).map((sideAction) => (
          <MapTargetPrimaryAction key={sideAction.label} action={sideAction} compact iconOnly />
        ))}
      </MapTargetActionRow>
    </MapTargetSheetFrame>
  )
}

function PathFacts({
  computing,
  notice,
  path,
}: {
  computing: boolean
  notice?: string | null
  path?: { distanceMeters: number; durationSeconds: number } | null
}) {
  const { formatDistance } = useFormat()
  if (computing) {
    return (
      <View style={styles.pathFacts}>
        <ActivityIndicator size="small" color={theme.neutral.textSecondary} />
        <Text style={styles.pathFactText}>Finding a path…</Text>
      </View>
    )
  }

  if (notice) {
    return (
      <View style={styles.notice}>
        <WarningIcon size={16} color={theme.status.warning.text} weight="bold" />
        <Text style={styles.noticeText}>{notice}</Text>
      </View>
    )
  }

  if (!path || path.distanceMeters <= 0) return null

  return (
    <View style={styles.pathFacts}>
      <PathIcon size={16} color={theme.neutral.textSecondary} weight="bold" />
      <Text style={styles.pathFactText}>{formatDistance(path.distanceMeters)}</Text>
      {path.durationSeconds > 0 ? (
        <>
          <TimerIcon size={16} color={theme.neutral.textSecondary} weight="bold" />
          <Text style={styles.pathFactText}>{fmtRideDuration(path.durationSeconds)}</Text>
        </>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  profileRow: {
    flexDirection: 'row',
    justifyContent: 'center',
  },
  pathFacts: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 22,
  },
  pathFactText: {
    color: theme.neutral.textSecondary,
    fontSize: 12,
    fontWeight: '700',
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
