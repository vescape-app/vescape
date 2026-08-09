import { ArrowClockwiseIcon, NavigationArrowIcon, XIcon } from 'phosphor-react-native'
import type { MapPoint, MapPointPatch, NavigationStatus } from 'vescape-core'

import { theme } from '@/constants/theme'
import { MapTargetSheet } from '@/modules/map-points/components/MapTargetSheet'
import type { MapSelection } from '@/modules/map/lib/mapSelection'

interface MapTargetSheetHostProps {
  /** What the rider just tapped, searched or dropped. Takes the sheet when present. */
  selectedTarget: MapSelection | null
  /** Where the rider is currently navigating. Shown only when nothing else is selected. */
  activeTarget: MapSelection | null
  /** The add menu owns the same corner, so the navigation sheet steps aside while it is open. */
  activeTargetSuppressed: boolean
  bottom: number
  /** Set while the selected Map Point is in its edit draft. */
  editingMapPointId: string | null
  actionColor: string
  actionTextColor: string
  onBeginEdit: (id: string) => void
  onEndEdit: () => void
  onNavigateSelected: () => void
  onCancelNavigation: () => void
  /** How the path to the active target ended up. `null` while there is no Navigation at all. */
  navigationStatus: NavigationStatus | null
  /** Rider-initiated recompute, offered only when the path failed. */
  onRetryNavigation: () => void
  onDismissSelected: () => void
  onAddFeature: () => void
  onSaveMapPoint: (id: string, patch: MapPointPatch) => Promise<MapPoint | null>
  onVoteMapPoint: (id: string, reaction: 'up' | 'down' | null) => void
  onRemoveMapPoint: (id: string) => void
  onFocusTarget: (target: MapSelection) => void
  /** Gates every write. Returns false when the rider still has to sign in. */
  requireAccount: () => boolean
}

/**
 * Both target sheets the map can show, and the one rule between them: a selection always wins over
 * the active navigation target, so only one sheet is ever on screen.
 */
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
  navigationStatus,
  onRetryNavigation,
  onDismissSelected,
  onAddFeature,
  onSaveMapPoint,
  onVoteMapPoint,
  onRemoveMapPoint,
  onFocusTarget,
  requireAccount,
}: MapTargetSheetHostProps) {
  const actionColors = {
    color: actionColor,
    textColor: actionTextColor,
    borderColor: actionColor,
    bgColor: theme.alpha(actionColor, 0.12),
  }

  if (selectedTarget) {
    const isMapPoint = selectedTarget.type === 'mapPoint'
    const editing = isMapPoint && editingMapPointId === selectedTarget.id
    const ownedByMe = isMapPoint && selectedTarget.point.ownedByMe

    return (
      <MapTargetSheet
        key={selectedTarget.id}
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

  const cancelAction = {
    ...actionColors,
    label: 'Cancel navigation',
    accessibilityLabel: 'Cancel navigation',
    Icon: XIcon,
    onPress: onCancelNavigation,
  }
  // No path was computed. Retry leads, because it is the only thing that can change the situation —
  // and it only ever happens on this tap, never on its own.
  const failureNotice = navigationStatus ? NAVIGATION_FAILURE_NOTICES[navigationStatus] : null
  const retryAction = failureNotice
    ? {
        ...actionColors,
        label: 'Retry',
        accessibilityLabel: 'Retry path to target',
        Icon: ArrowClockwiseIcon,
        onPress: onRetryNavigation,
      }
    : null

  return (
    <MapTargetSheet
      key={activeTarget.id}
      target={activeTarget}
      bottom={bottom}
      mode="navigation"
      action={retryAction ?? cancelAction}
      secondaryAction={retryAction ? cancelAction : undefined}
      notice={failureNotice}
      onFocusTarget={() => onFocusTarget(activeTarget)}
    />
  )
}

/**
 * What the rider is told when no line is drawn. Deliberately says what is missing rather than
 * apologising: the pin, the bearing and the distance are still there, and in a trackless forest
 * that is all the information that exists.
 */
const NAVIGATION_FAILURE_NOTICES: Record<NavigationStatus, string | null> = {
  ready: null,
  fetchFailed: 'No path yet — could not reach routing. Check your signal and retry.',
  noPathFound: 'No path leads here. Ride by the pin, bearing and distance.',
}
