import { ArrowClockwiseIcon, CheckIcon, NavigationArrowIcon, XIcon } from 'phosphor-react-native'
import type { MapPoint, MapPointPatch, NavigationProfile, NavigationStatus } from 'vescape-core'

import { theme, type ThemeColor } from '@/constants/theme'
import { useColoredAction, useResolvedAccentColors } from '@/hooks/useTheme'
import { ActiveNavigationSheet } from '@/modules/map-points/components/ActiveNavigationSheet'
import { MapTargetSheet } from '@/modules/map-points/components/MapTargetSheet'
import { NavigationProfileSelector } from '@/modules/map/components/NavigationProfileSelector'
import type { MapSelection } from '@/modules/map/lib/mapSelection'

interface MapTargetSheetHostProps {
  selectedTarget: MapSelection | null
  activeTarget: MapSelection | null
  activeTargetSuppressed: boolean
  bottom: number
  editingMapPointId: string | null
  actionColor: ThemeColor
  actionTextColor: ThemeColor
  onBeginEdit: (id: string) => void
  onEndEdit: () => void
  onNavigateSelected: () => void
  onCancelNavigation: () => void
  onConfirmNavigation: () => void
  activeNavigationAccepted: boolean
  onEditActiveNavigation: () => void
  navigationRemainingDistanceMeters: number | null
  navigationRemainingDurationSeconds: number | null
  navigationStatus: NavigationStatus | null
  navigationPath: { distanceMeters: number; durationSeconds: number } | null
  navigationComputing: boolean
  navigationProfile: NavigationProfile | null
  onRecomputeNavigation: () => void
  onSelectNavigationProfile: (profile: NavigationProfile) => void
  onDismissSelected: () => void
  onSignInForDetails?: () => void
  onAddFeature: () => void
  onSaveMapPoint: (id: string, patch: MapPointPatch) => Promise<MapPoint | null>
  onVoteMapPoint: (id: string, reaction: 'up' | 'down' | null) => void
  onRemoveMapPoint: (id: string) => void
  onFocusTarget: (target: MapSelection) => void
  requireAccount: () => boolean
}

export function MapTargetSheetHost({
  selectedTarget,
  activeTarget,
  activeTargetSuppressed,
  bottom,
  editingMapPointId,
  actionColor,
  actionTextColor,
  onBeginEdit,
  onEndEdit,
  onNavigateSelected,
  onCancelNavigation,
  onConfirmNavigation,
  activeNavigationAccepted,
  onEditActiveNavigation,
  navigationRemainingDistanceMeters,
  navigationRemainingDurationSeconds,
  navigationStatus,
  navigationPath,
  navigationComputing,
  navigationProfile,
  onRecomputeNavigation,
  onSelectNavigationProfile,
  onDismissSelected,
  onSignInForDetails,
  onAddFeature,
  onSaveMapPoint,
  onVoteMapPoint,
  onRemoveMapPoint,
  onFocusTarget,
  requireAccount,
}: MapTargetSheetHostProps) {
  const accents = useResolvedAccentColors()
  const confirmSurface = useColoredAction(actionColor)
  const cancelSurface = useColoredAction(accents.red.light)
  const actionColors = {
    color: actionColor,
    textColor: actionColor,
    borderColor: actionColor,
    bgColor: confirmSurface,
  }

  if (selectedTarget) {
    const isMapPoint = selectedTarget.type === 'mapPoint'
    const editing = isMapPoint && editingMapPointId === selectedTarget.id
    const ownedByMe = isMapPoint && selectedTarget.point.ownedByMe

    return (
      <MapTargetSheet
        key={selectedTarget.id}
        onSignInForDetails={onSignInForDetails}
        target={selectedTarget}
        bottom={bottom}
        mode={editing ? 'edit' : 'select'}
        action={{
          ...actionColors,
          label: editing ? 'Save' : 'Navigate',
          accessibilityLabel: editing ? 'Save map feature' : 'Navigate to target',
          Icon: NavigationArrowIcon,
          onPress: onNavigateSelected,
        }}
        targetColor={actionColor}
        targetTextColor={actionTextColor}
        onAddFeature={isMapPoint ? undefined : onAddFeature}
        onEdit={
          ownedByMe
            ? () => {
                if (!requireAccount()) return
                onBeginEdit(selectedTarget.id)
              }
            : undefined
        }
        onSave={onEndEdit}
        onSaveMapPoint={onSaveMapPoint}
        onVoteMapPoint={(id, nextReaction) => {
          if (!requireAccount()) return false
          onVoteMapPoint(id, nextReaction)
          return true
        }}
        onFocusTarget={() => onFocusTarget(selectedTarget)}
        onDelete={
          ownedByMe
            ? () => {
                if (!requireAccount()) return
                onEndEdit()
                onRemoveMapPoint(selectedTarget.id)
              }
            : undefined
        }
        onDismiss={onDismissSelected}
      />
    )
  }

  if (!activeTarget || activeTargetSuppressed) return null

  if (activeNavigationAccepted) {
    return (
      <ActiveNavigationSheet
        target={activeTarget}
        bottom={bottom}
        remainingDistanceMeters={navigationRemainingDistanceMeters}
        durationSeconds={navigationRemainingDurationSeconds ?? 0}
        targetColor={actionColor}
        targetTextColor={actionTextColor}
        accentColor={accents.purple.light}
        cancelColor={accents.red.light}
        cancelBackgroundColor={cancelSurface}
        onOpen={onEditActiveNavigation}
        onCancel={onCancelNavigation}
      />
    )
  }

  const cancelAction = {
    color: accents.red.light,
    textColor: accents.red.light,
    borderColor: accents.red.light,
    bgColor: cancelSurface,
    label: 'Cancel',
    accessibilityLabel: 'Cancel navigation',
    Icon: XIcon,
    onPress: onCancelNavigation,
  }
  const failureNotice = navigationStatus ? NAVIGATION_FAILURE_NOTICES[navigationStatus] : null
  const confirmAction = {
    ...actionColors,
    label: 'Ride it',
    accessibilityLabel: 'Accept path and return to ride view',
    Icon: CheckIcon,
    onPress: onConfirmNavigation,
  }
  const recomputeAction = {
    ...NAVIGATION_ACTION_COLORS.recompute,
    label: failureNotice ? 'Retry' : 'Recompute',
    accessibilityLabel: failureNotice ? 'Retry path to target' : 'Recompute path from here',
    Icon: ArrowClockwiseIcon,
    onPress: onRecomputeNavigation,
  }

  return (
    <MapTargetSheet
      key={activeTarget.id}
      target={activeTarget}
      bottom={bottom}
      mode="navigation"
      action={confirmAction}
      sideActions={[recomputeAction, cancelAction]}
      targetColor={actionColor}
      targetTextColor={actionTextColor}
      notice={failureNotice}
      path={navigationPath}
      computing={navigationComputing}
      profileSelector={
        navigationProfile ? (
          <NavigationProfileSelector
            activeProfile={navigationProfile}
            open
            onSelect={onSelectNavigationProfile}
          />
        ) : null
      }
      onFocusTarget={() => onFocusTarget(activeTarget)}
    />
  )
}

const NAVIGATION_ACTION_COLORS = {
  recompute: {
    color: theme.control.textMuted,
    textColor: theme.control.textMuted,
    borderColor: theme.control.border,
    bgColor: theme.alpha(theme.control.background, 0.85),
  },
} as const

const NAVIGATION_FAILURE_NOTICES: Record<NavigationStatus, string | null> = {
  ready: null,
  fetchFailed: 'No path yet — could not reach routing. Check your signal and retry.',
  noPathFound: 'No path leads here. Ride by the pin, bearing and distance.',
}
