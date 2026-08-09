import { ArrowClockwiseIcon, NavigationArrowIcon, XIcon } from 'phosphor-react-native'
import type { MapPoint, MapPointPatch, NavigationProfile, NavigationStatus } from 'vescape-core'

import { theme } from '@/constants/theme'
import { MapTargetSheet } from '@/modules/map-points/components/MapTargetSheet'
import { NavigationProfileSelector } from '@/modules/map/components/NavigationProfileSelector'
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
  /**
   * Which kind of ways produced the drawn path. `null` while there is no Navigation, which is when
   * the switcher has nothing to be the current state of and is not shown.
   */
  navigationProfile: NavigationProfile | null
  /** Rider-initiated recompute. The only thing that ever replaces a Navigation. */
  onRecomputeNavigation: () => void
  onSelectNavigationProfile: (profile: NavigationProfile) => void
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
  navigationProfile,
  onRecomputeNavigation,
  onSelectNavigationProfile,
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
  const failureNotice = navigationStatus ? NAVIGATION_FAILURE_NOTICES[navigationStatus] : null
  // Recompute always leads, in the same slot whether or not there is a path: after a failure it is
  // the only thing that can change the situation, and with a path drawn it is how the rider asks for
  // a fresh one from where they are now. It only ever happens on this tap, never on its own.
  const recomputeAction = {
    ...actionColors,
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
      action={recomputeAction}
      secondaryAction={cancelAction}
      notice={failureNotice}
      profileSelector={
        navigationProfile ? (
          <NavigationProfileSelector
            activeProfile={navigationProfile}
            onSelect={onSelectNavigationProfile}
          />
        ) : null
      }
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
