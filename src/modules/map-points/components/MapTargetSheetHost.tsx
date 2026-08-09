import { ArrowClockwiseIcon, CheckIcon, NavigationArrowIcon, XIcon } from 'phosphor-react-native'
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
  /** The rider accepting the drawn path: the map steps aside and the ride view takes over. */
  onConfirmNavigation: () => void
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
  onConfirmNavigation,
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
    ...NAVIGATION_ACTION_COLORS.cancel,
    label: 'Cancel',
    accessibilityLabel: 'Cancel navigation',
    Icon: XIcon,
    onPress: onCancelNavigation,
  }
  const failureNotice = navigationStatus ? NAVIGATION_FAILURE_NOTICES[navigationStatus] : null
  // Setting a Direction Point leaves the rider on the map looking at the path, because a path is a
  // proposal: they check where it goes, switch the Profile, ask again — and only then accept it.
  // Accepting is what closes the map, so it leads the row while the other two flank it.
  const confirmAction = {
    ...NAVIGATION_ACTION_COLORS.confirm,
    label: 'Ride it',
    accessibilityLabel: 'Accept path and return to ride view',
    Icon: CheckIcon,
    onPress: onConfirmNavigation,
  }
  // After a failure recompute is the only thing that can change the situation; with a path drawn it
  // is how the rider asks for a fresh one from where they are now. Never happens on its own.
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

/**
 * The three navigation actions read as three different decisions, so they do not share the Map
 * Point's colour the way the select sheet's single action does: accepting the path is the way on
 * (green), asking again is neutral work (slate), and dropping the Navigation is destructive (red).
 * Emphasis is border and text on a dark tinted pill — never a bright fill; see `docs/design.md`.
 */
const NAVIGATION_ACTION_COLORS = {
  confirm: {
    color: theme.palette.green.color,
    textColor: theme.palette.green.text,
    borderColor: theme.palette.green.color,
    bgColor: theme.alpha(theme.palette.green.color, 0.12),
  },
  recompute: {
    color: theme.palette.slate.color,
    textColor: theme.palette.slate.textSecondary,
    borderColor: theme.palette.slate.border,
    bgColor: theme.alpha(theme.palette.slate.color, 0.12),
  },
  cancel: {
    color: theme.palette.red.color,
    textColor: theme.palette.red.text,
    borderColor: theme.alpha(theme.palette.red.color, 0.4),
    bgColor: theme.alpha(theme.palette.red.color, 0.1),
  },
} as const

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
