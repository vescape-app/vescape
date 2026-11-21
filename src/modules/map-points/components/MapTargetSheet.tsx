import type { ThemeColor } from '@/constants/theme'
import type { ReactNode } from 'react'
import type { MapPoint, MapPointPatch } from 'vescape-core'

import { MapTargetEditBody } from '@/modules/map-points/components/MapTargetSheetEditBody'
import { MapTargetNavigationBody } from '@/modules/map-points/components/MapTargetSheetNavigationBody'
import { MapTargetSelectBody } from '@/modules/map-points/components/MapTargetSheetSelectBody'
import type { MapTargetSheetAction } from '@/modules/map-points/components/mapTargetSheetChrome'
import { useMapPointMedia } from '@/modules/map-points/hooks/useMapPointMedia'
import type { MapSelection } from '@/modules/map/lib/mapSelection'

export function MapTargetSheet({
  target,
  bottom,
  mode,
  action,
  sideActions,
  targetColor,
  targetTextColor,
  notice,
  path,
  computing,
  profileSelector,
  onSignInForDetails,
  onAddFeature,
  onEdit,
  onSave,
  onSaveMapPoint,
  onVoteMapPoint,
  onDelete,
  onDismiss,
  onFocusTarget,
}: {
  target: MapSelection
  bottom: number
  mode: 'select' | 'navigation' | 'edit'
  action: MapTargetSheetAction
  sideActions?: readonly MapTargetSheetAction[]
  targetColor?: ThemeColor
  targetTextColor?: ThemeColor
  notice?: string | null
  path?: { distanceMeters: number; durationSeconds: number } | null
  computing?: boolean
  profileSelector?: ReactNode
  onSignInForDetails?: () => void
  onAddFeature?: () => void
  onEdit?: () => void
  onSave?: () => void
  onSaveMapPoint?: (id: string, patch: MapPointPatch) => Promise<MapPoint | null>
  onVoteMapPoint?: (id: string, reaction: 'up' | 'down' | null) => boolean
  onDelete?: () => void
  onDismiss?: () => void
  onFocusTarget?: () => void
}) {
  const point = target.type === 'mapPoint' ? target.point : null
  const media = useMapPointMedia(point)

  if (mode === 'edit') {
    if (target.type !== 'mapPoint') return null
    return (
      <MapTargetEditBody
        target={target}
        bottom={bottom}
        media={media}
        onSave={onSave}
        onSaveMapPoint={onSaveMapPoint}
        onDelete={onDelete}
        onDismiss={onDismiss}
        onFocusTarget={onFocusTarget}
      />
    )
  }

  if (mode === 'navigation') {
    return (
      <MapTargetNavigationBody
        target={target}
        bottom={bottom}
        action={action}
        sideActions={sideActions}
        targetColor={targetColor ?? action.color}
        targetTextColor={targetTextColor ?? action.textColor}
        notice={notice}
        path={path}
        computing={computing}
        profileSelector={profileSelector}
        media={media.assets}
        onDismiss={onDismiss}
        onFocusTarget={onFocusTarget}
      />
    )
  }

  return (
    <MapTargetSelectBody
      onSignInForDetails={onSignInForDetails}
      target={target}
      bottom={bottom}
      action={action}
      media={media.assets}
      onAddFeature={onAddFeature}
      onEdit={onEdit}
      onVoteMapPoint={onVoteMapPoint}
      onDismiss={onDismiss}
      onFocusTarget={onFocusTarget}
    />
  )
}
