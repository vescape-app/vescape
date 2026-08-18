import { useRouter } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'

import { ConfirmModal } from '@/components/modals/ConfirmModal'
import { useRiderStore } from '@/modules/group-ride/store/riderStore'
import type { MapSelection } from '@/modules/map/lib/mapSelection'
import { useMapStore } from '@/modules/map/store/mapStore'
import { MapTargetSheetHost } from '@/modules/map-points/components/MapTargetSheetHost'
import { useMapContributionReady } from '@/modules/profile/hooks/useMapContributionReady'
import { routes } from '@/navigation/routes'
import { FullMapControls } from '@/screens/main/map/FullMapControls'
import { navigationActionColors } from '@/screens/main/map/navigationActionColors'
import type { MapModeOverlayProps } from '@/screens/main/map/mapModeOverlayTypes'

/**
 * Explore mode. Owns the map's write-side state — what is selected, what is being edited, whether
 * the add menu is placing a feature — and the sign-in gate every one of those writes goes through.
 */
export function MapModeOverlay({
  visible,
  mapRef,
  mapInteractionHandlerRef,
  top,
  bottom,
  sheetBottom,
  searchProximity,
  directionPoint,
  activeNavigationTarget,
  selectedNavigationTarget,
  longPressMapTarget,
  onExit,
  onLongPressMapTargetHandled,
  onSelectNavigationTarget,
  onNavigateTarget,
  onNavigateSelectedTarget,
  onCancelNavigation,
  onDismissSelectedTarget,
  updateMapPoint,
  setMapPointReaction,
  onRemoveMapPoint,
}: MapModeOverlayProps) {
  const router = useRouter()
  // The server authorizes Map Point writes on the Device Token, so that is what gates the UI.
  const canContribute = useMapContributionReady()
  const riderColor = useRiderStore((s) => s.riderColor)
  const [signInPromptVisible, setSignInPromptVisible] = useState(false)
  const [editingMapPointId, setEditingMapPointId] = useState<string | null>(null)
  const [addMenuOpen, setAddMenuOpen] = useState(false)

  // Native owns whether a path exists; this only decides what the sheet says about it. Read here
  // rather than drilled from the screen, because the sheet is its only consumer.
  const navigationStatus = useMapStore((s) => s.navigation?.status ?? null)
  const navigationProfile = useMapStore((s) => s.navigation?.profile ?? null)
  const navigationDistanceMeters = useMapStore((s) => s.navigation?.distanceMeters ?? 0)
  const navigationDurationSeconds = useMapStore((s) => s.navigation?.durationSeconds ?? 0)
  const navigationComputing = useMapStore((s) => s.navigationComputing)
  const recomputeNavigation = useMapStore((s) => s.recomputeNavigation)
  const setNavigationProfile = useMapStore((s) => s.setNavigationProfile)

  const navigationTarget =
    activeNavigationTarget ??
    (directionPoint
      ? ({
          type: 'coordinate',
          id: `direction-${directionPoint.latitude}-${directionPoint.longitude}`,
          latitude: directionPoint.latitude,
          longitude: directionPoint.longitude,
          title: 'Direction point',
          subtitle: null,
        } satisfies MapSelection)
      : null)
  const targetSheetVisible =
    selectedNavigationTarget != null || (navigationTarget != null && !addMenuOpen)
  const navigationAction = navigationActionColors(riderColor)

  const focusTargetOnMap = useCallback(
    (target: MapSelection) => {
      mapRef.current?.centerCoordinatePreservingCamera([target.longitude, target.latitude])
    },
    [mapRef],
  )

  const requireMapAccount = useCallback(() => {
    if (canContribute) return true
    setSignInPromptVisible(true)
    return false
  }, [canContribute])

  useEffect(() => {
    if (selectedNavigationTarget?.type === 'mapPoint') return
    const frame = requestAnimationFrame(() => setEditingMapPointId(null))
    return () => cancelAnimationFrame(frame)
  }, [selectedNavigationTarget])

  useEffect(() => {
    if (visible) return
    const frame = requestAnimationFrame(() => setAddMenuOpen(false))
    return () => cancelAnimationFrame(frame)
  }, [visible])

  // A long press on the map is a request to place a feature there: centre it, then open the add
  // menu on that spot.
  useEffect(() => {
    if (!visible || !longPressMapTarget) return
    const frame = requestAnimationFrame(() => {
      if (!canContribute) {
        setSignInPromptVisible(true)
        onLongPressMapTargetHandled()
        return
      }
      mapRef.current?.centerCoordinatePreservingCamera([
        longPressMapTarget.longitude,
        longPressMapTarget.latitude,
      ])
      setEditingMapPointId(null)
      setAddMenuOpen(true)
      onDismissSelectedTarget()
      onLongPressMapTargetHandled()
    })
    return () => cancelAnimationFrame(frame)
  }, [
    canContribute,
    longPressMapTarget,
    mapRef,
    onDismissSelectedTarget,
    onLongPressMapTargetHandled,
    visible,
  ])

  const handleOpenAddFeatureAtSelectedTarget = useCallback(() => {
    if (!selectedNavigationTarget || selectedNavigationTarget.type === 'mapPoint') return
    if (!requireMapAccount()) return
    mapRef.current?.centerCoordinatePreservingCamera([
      selectedNavigationTarget.longitude,
      selectedNavigationTarget.latitude,
    ])
    setEditingMapPointId(null)
    setAddMenuOpen(true)
    onDismissSelectedTarget()
  }, [mapRef, onDismissSelectedTarget, requireMapAccount, selectedNavigationTarget])

  return (
    <>
      <View
        pointerEvents={visible ? 'box-none' : 'none'}
        style={[styles.mapInterface, visible ? styles.visible : styles.hidden]}
      >
        {visible ? (
          <FullMapControls
            mapRef={mapRef}
            mapInteractionHandlerRef={mapInteractionHandlerRef}
            top={top}
            bottom={bottom}
            sheetBottom={sheetBottom}
            searchProximity={searchProximity}
            onExit={onExit}
            onSelectNavigationTarget={onSelectNavigationTarget}
            onNavigateTarget={onNavigateTarget}
            bottomControlsVisible={!targetSheetVisible}
            addMenuOpen={addMenuOpen}
            onAddMenuVisibilityChange={setAddMenuOpen}
            onBeginEditMapPoint={setEditingMapPointId}
            onRequireMapAccount={requireMapAccount}
          />
        ) : null}
        {visible ? (
          <MapTargetSheetHost
            selectedTarget={selectedNavigationTarget}
            activeTarget={navigationTarget}
            activeTargetSuppressed={addMenuOpen}
            bottom={sheetBottom}
            editingMapPointId={editingMapPointId}
            actionColor={navigationAction.color}
            actionTextColor={navigationAction.textColor}
            onBeginEdit={setEditingMapPointId}
            onEndEdit={() => setEditingMapPointId(null)}
            onNavigateSelected={() => void onNavigateSelectedTarget()}
            onCancelNavigation={onCancelNavigation}
            onConfirmNavigation={onExit}
            navigationStatus={navigationStatus}
            navigationPath={
              navigationStatus === 'ready'
                ? {
                    distanceMeters: navigationDistanceMeters,
                    durationSeconds: navigationDurationSeconds,
                  }
                : null
            }
            navigationComputing={navigationComputing}
            navigationProfile={navigationProfile}
            onRecomputeNavigation={() => void recomputeNavigation()}
            onSelectNavigationProfile={(profile) => void setNavigationProfile(profile)}
            onDismissSelected={() => {
              setEditingMapPointId(null)
              setAddMenuOpen(false)
              onDismissSelectedTarget()
            }}
            onAddFeature={handleOpenAddFeatureAtSelectedTarget}
            onSaveMapPoint={updateMapPoint}
            onVoteMapPoint={setMapPointReaction}
            onRemoveMapPoint={onRemoveMapPoint}
            onFocusTarget={focusTargetOnMap}
            requireAccount={requireMapAccount}
          />
        ) : null}
      </View>

      <ConfirmModal
        visible={signInPromptVisible}
        title="Sign in to contribute"
        message="A Vescape account is required to add, edit, delete, or react to map features. Map features are shared with other riders."
        confirmLabel="Sign in"
        cancelLabel="Not now"
        onConfirm={() => {
          setSignInPromptVisible(false)
          router.push(routes.signIn)
        }}
        onCancel={() => setSignInPromptVisible(false)}
      />
    </>
  )
}

const styles = StyleSheet.create({
  mapInterface: {
    ...StyleSheet.absoluteFill,
    zIndex: 44,
  },
  visible: {
    opacity: 1,
  },
  hidden: {
    opacity: 0,
  },
})
