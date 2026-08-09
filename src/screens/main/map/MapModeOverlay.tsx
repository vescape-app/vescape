import * as Haptics from 'expo-haptics'
import { useRouter } from 'expo-router'
import { ArrowLeftIcon, MagnifyingGlassIcon, MapPinIcon, XIcon } from 'phosphor-react-native'
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native'
import Animated, { FadeOut, withTiming } from 'react-native-reanimated'
import type { MapPoint, MapPointCategory, MapPointPatch } from 'vescape-core'

import { IconButton } from '@/components/base/IconButton'
import { Text } from '@/components/base/Text'
import { ConfirmModal } from '@/components/modals/ConfirmModal'
import { theme } from '@/constants/theme'
import { getMapPointKindLabel } from '@/modules/map-points/constants/mapPoints'
import { MapPointAddMenu } from '@/modules/map-points/components/MapPointAddMenu'
import { MapPointFilterMenu } from '@/modules/map-points/components/MapPointFilterMenu'
import { MapTargetSheetHost } from '@/modules/map-points/components/MapTargetSheetHost'
import { useMapPointStore } from '@/modules/map-points/store/mapPointStore'
import { useMapSearch } from '@/modules/map/hooks/useMapSearch'
import type { MapSelection } from '@/modules/map/lib/mapSelection'
import { type MapSearchResult } from '@/modules/map/lib/search'
import { useMapStore, type DirectionPoint } from '@/modules/map/store/mapStore'
import { useRiderStore } from '@/modules/group-ride/store/riderStore'
import { useMapContributionReady } from '@/modules/profile/hooks/useMapContributionReady'
import { routes } from '@/navigation/routes'
import { type MainMapHandle } from '@/screens/main/map/MainMap'
import { MapVignette } from '@/screens/main/map/MapVignette'

interface MapModeOverlayProps {
  visible: boolean
  mapRef: RefObject<MainMapHandle | null>
  mapInteractionHandlerRef: RefObject<(selection?: MapSelection) => boolean | void>
  /** Top of the map's control row, shared with the mode tabs. */
  top: number
  /** Where the add and filter menus sit above the telemetry strip. */
  bottom: number
  /** Where the target sheet sits above the safe area. */
  sheetBottom: number
  searchProximity: { latitude: number; longitude: number } | null
  directionPoint: DirectionPoint | null
  activeNavigationTarget: MapSelection | null
  selectedNavigationTarget: MapSelection | null
  longPressMapTarget: MapSelection | null
  onExit: () => void
  onLongPressMapTargetHandled: () => void
  onSelectNavigationTarget: (selection: MapSelection) => void
  onNavigateTarget: (selection: MapSelection) => Promise<void>
  onNavigateSelectedTarget: () => Promise<void>
  onCancelNavigation: () => void
  onDismissSelectedTarget: () => void
  updateMapPoint: (id: string, patch: MapPointPatch) => Promise<MapPoint | null>
  setMapPointReaction: (id: string, reaction: 'up' | 'down' | null) => void
  onRemoveMapPoint: (id: string) => void
}

function clearPlacementTimeoutRef(ref: { current: ReturnType<typeof setTimeout> | null }) {
  if (!ref.current) return
  clearTimeout(ref.current)
  ref.current = null
}

function navigationActionColors(riderColor: string | null) {
  return {
    color: riderColor ?? theme.palette.green.color,
    textColor: riderColor ?? theme.palette.green.text,
  }
}

const centerPlacementPointerEntering = () => {
  'worklet'
  return {
    initialValues: {
      opacity: 0,
      transform: [{ scale: 1.2 }],
    },
    animations: {
      opacity: withTiming(1, { duration: 260 }),
      transform: [{ scale: withTiming(1, { duration: 260 }) }],
    },
  }
}

const centerPlacementPulseEntering = () => {
  'worklet'
  return {
    initialValues: {
      opacity: 0.65,
      transform: [{ scale: 0.75 }],
    },
    animations: {
      opacity: withTiming(0, { duration: 320 }),
      transform: [{ scale: withTiming(2.05, { duration: 320 }) }],
    },
  }
}

function CenterPlacementPointer({ color, pulseKey }: { color: string; pulseKey: number }) {
  return (
    <Animated.View
      pointerEvents="none"
      entering={centerPlacementPointerEntering}
      exiting={FadeOut.duration(140)}
      style={styles.centerPlacementPointer}
    >
      {pulseKey > 0 ? (
        <Animated.View
          key={pulseKey}
          entering={centerPlacementPulseEntering}
          style={[styles.centerPlacementPulse, { borderColor: color }]}
        />
      ) : null}
      <View style={[styles.centerPlacementBall, { borderColor: color }]}>
        <View style={[styles.centerPlacementDot, { backgroundColor: color }]} />
      </View>
    </Animated.View>
  )
}

interface FullMapControlsProps extends Pick<
  MapModeOverlayProps,
  | 'mapRef'
  | 'mapInteractionHandlerRef'
  | 'top'
  | 'bottom'
  | 'sheetBottom'
  | 'searchProximity'
  | 'onExit'
  | 'onSelectNavigationTarget'
  | 'onNavigateTarget'
> {
  bottomControlsVisible: boolean
  addMenuOpen: boolean
  onAddMenuVisibilityChange: (visible: boolean) => void
  onBeginEditMapPoint: (id: string) => void
  onRequireMapAccount: () => boolean
}

/** Search, the Map Point add menu and the category filter — everything only Explore mode shows. */
function FullMapControls({
  mapRef,
  mapInteractionHandlerRef,
  top,
  bottom,
  sheetBottom,
  searchProximity,
  onExit,
  onSelectNavigationTarget,
  onNavigateTarget,
  bottomControlsVisible,
  addMenuOpen,
  onAddMenuVisibilityChange,
  onBeginEditMapPoint,
  onRequireMapAccount,
}: FullMapControlsProps) {
  const riderColor = useRiderStore((s) => s.riderColor)
  // Category visibility and Map Point creation are store truth, not screen wiring.
  const hiddenMapPointCategories = useMapPointStore((s) => s.hiddenMapPointCategories)
  const toggleMapPointCategoryVisibility = useMapPointStore(
    (s) => s.toggleMapPointCategoryVisibility,
  )
  const addMapPoint = useMapPointStore((s) => s.addMapPoint)
  const [searchOpen, setSearchOpen] = useState(false)
  const [placementPulseKey, setPlacementPulseKey] = useState(0)
  const [filterMenuOpen, setFilterMenuOpen] = useState(false)
  const placementTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const addMenuZoomedRef = useRef(false)
  const {
    searchQuery,
    setSearchQuery,
    searchResults,
    searchLoading,
    searchError,
    handleSearchQueryChange,
    resetSearch,
  } = useMapSearch({ searchOpen, proximityLocation: searchProximity })

  const openSearch = useCallback(() => {
    setSearchOpen(true)
  }, [])

  const closeSearch = useCallback(() => {
    setSearchOpen(false)
    resetSearch()
  }, [resetSearch])

  const closeAddMenu = useCallback(
    (restoreZoom = true) => {
      clearPlacementTimeoutRef(placementTimeoutRef)
      if (addMenuOpen && restoreZoom && addMenuZoomedRef.current) {
        mapRef.current?.zoomBy(-0.45)
      }
      addMenuZoomedRef.current = false
      setPlacementPulseKey(0)
      onAddMenuVisibilityChange(false)
    },
    [addMenuOpen, mapRef, onAddMenuVisibilityChange],
  )

  useEffect(() => {
    const dismissTransientControls = (selection?: MapSelection) => {
      if (addMenuOpen && selection) {
        mapRef.current?.centerCoordinatePreservingCamera([selection.longitude, selection.latitude])
        return true
      }
      if (!searchOpen && !filterMenuOpen) return false
      closeSearch()
      setFilterMenuOpen(false)
      return false
    }
    mapInteractionHandlerRef.current = dismissTransientControls
    return () => {
      if (mapInteractionHandlerRef.current === dismissTransientControls) {
        mapInteractionHandlerRef.current = () => {}
      }
    }
  }, [addMenuOpen, closeSearch, filterMenuOpen, mapInteractionHandlerRef, mapRef, searchOpen])

  useEffect(
    () => () => {
      if (placementTimeoutRef.current) clearTimeout(placementTimeoutRef.current)
    },
    [],
  )

  const handleSearchSelect = useCallback(
    (result: MapSearchResult) => {
      setSearchOpen(false)
      setSearchQuery(result.title)
      mapRef.current?.focusCoordinate([result.longitude, result.latitude])
      onSelectNavigationTarget({
        type: 'place',
        id: result.id,
        latitude: result.latitude,
        longitude: result.longitude,
        title: result.title,
        subtitle: result.subtitle,
        category: null,
      })
    },
    [mapRef, onSelectNavigationTarget, setSearchQuery],
  )

  const handleSearchSubmit = useCallback(() => {
    const first = searchResults[0]
    if (first) handleSearchSelect(first)
  }, [handleSearchSelect, searchResults])

  const showNoResults =
    !searchLoading && !searchError && searchQuery.trim().length >= 2 && searchResults.length === 0

  const toggleAddMenu = useCallback(() => {
    setFilterMenuOpen(false)
    if (addMenuOpen) {
      closeAddMenu()
      return
    }
    if (!onRequireMapAccount()) return
    mapRef.current?.zoomBy(0.45)
    addMenuZoomedRef.current = true
    setPlacementPulseKey(0)
    onAddMenuVisibilityChange(true)
  }, [addMenuOpen, closeAddMenu, mapRef, onAddMenuVisibilityChange, onRequireMapAccount])

  const toggleFilterMenu = useCallback(() => {
    closeAddMenu()
    setFilterMenuOpen((open) => !open)
  }, [closeAddMenu])

  const handleExitMapFocus = useCallback(() => {
    closeAddMenu()
    onExit()
  }, [closeAddMenu, onExit])

  const handleSelectMapPoint = useCallback(
    async (category: MapPointCategory) => {
      const center = await mapRef.current?.getViewfinderCoordinate()
      if (!center) return
      await Haptics.selectionAsync()
      setPlacementPulseKey((key) => key + 1)
      clearPlacementTimeoutRef(placementTimeoutRef)
      placementTimeoutRef.current = setTimeout(() => {
        closeAddMenu()
        void addMapPoint(category, center.latitude, center.longitude).then((point) => {
          if (!point) return
          onSelectNavigationTarget({
            type: 'mapPoint',
            id: point.id,
            latitude: point.latitude,
            longitude: point.longitude,
            title: point.name?.trim() || getMapPointKindLabel(point.category),
            subtitle: null,
            point,
          })
          onBeginEditMapPoint(point.id)
        })
        placementTimeoutRef.current = null
      }, 180)
    },
    [addMapPoint, closeAddMenu, mapRef, onBeginEditMapPoint, onSelectNavigationTarget],
  )

  const handleSelectNavigationPoint = useCallback(async () => {
    const center = await mapRef.current?.getViewfinderCoordinate()
    if (!center) return
    await Haptics.selectionAsync()
    closeAddMenu()
    await onNavigateTarget({
      type: 'coordinate',
      id: `center-${center.longitude.toFixed(6)}-${center.latitude.toFixed(6)}`,
      latitude: center.latitude,
      longitude: center.longitude,
      title: 'Dropped pin',
      subtitle: null,
      loadingDetails: true,
    })
  }, [closeAddMenu, mapRef, onNavigateTarget])

  const navigationAction = navigationActionColors(riderColor)

  return (
    <>
      {addMenuOpen ? (
        <CenterPlacementPointer
          color={riderColor ?? theme.palette.green.color}
          pulseKey={placementPulseKey}
        />
      ) : null}
      {searchOpen ? <MapVignette mode="map" idPrefix="search-map-vignette" topOnly /> : null}
      <IconButton
        icon={ArrowLeftIcon}
        size="sm"
        testID="map-exit"
        onPress={handleExitMapFocus}
        style={[styles.mapTopBackButton, { top }]}
      />
      {searchOpen ? (
        <View style={[styles.mapSearchSheet, { top }]}>
          <View style={styles.mapSearchBar}>
            <MagnifyingGlassIcon
              size={22}
              color={theme.palette.slate.textSecondary}
              weight="bold"
            />
            <TextInput
              autoFocus
              selectTextOnFocus
              value={searchQuery}
              onChangeText={handleSearchQueryChange}
              onSubmitEditing={handleSearchSubmit}
              placeholder="Address or place"
              placeholderTextColor={theme.palette.slate.textMuted}
              returnKeyType="search"
              style={styles.mapSearchInput}
            />
            <Pressable
              accessibilityLabel="Close search"
              accessibilityRole="button"
              onPress={closeSearch}
              style={({ pressed }) => [
                styles.mapSearchClose,
                pressed && styles.mapSearchClosePressed,
              ]}
            >
              <XIcon size={22} color={theme.palette.slate.textSecondary} weight="bold" />
            </Pressable>
          </View>
          {searchLoading || searchError || showNoResults || searchResults.length > 0 ? (
            <View style={styles.mapSearchResults}>
              {searchLoading ? (
                <View style={styles.mapSearchStatusRow}>
                  <ActivityIndicator size="small" color={theme.palette.sky.color} />
                  <Text style={styles.mapSearchStatusText}>Searching Mapbox</Text>
                </View>
              ) : null}
              {searchError ? (
                <View style={styles.mapSearchStatusRow}>
                  <Text style={styles.mapSearchErrorText}>{searchError}</Text>
                </View>
              ) : null}
              {showNoResults ? (
                <View style={styles.mapSearchStatusRow}>
                  <Text style={styles.mapSearchStatusText}>No results</Text>
                </View>
              ) : null}
              {searchResults.map((result, index) => (
                <Pressable
                  key={result.id}
                  accessibilityRole="button"
                  style={({ pressed }) => [
                    styles.mapSearchResult,
                    pressed && styles.mapSearchResultPressed,
                  ]}
                  onPress={() => handleSearchSelect(result)}
                >
                  <View style={styles.mapSearchResultIcon}>
                    <MapPinIcon size={16} color={theme.palette.green.text} weight="duotone" />
                  </View>
                  <View style={styles.mapSearchResultText}>
                    <Text style={styles.mapSearchResultTitle} numberOfLines={1}>
                      {result.title}
                    </Text>
                    <Text style={styles.mapSearchResultSubtitle} numberOfLines={1}>
                      {result.subtitle}
                    </Text>
                  </View>
                  {index < searchResults.length - 1 ? (
                    <View style={styles.mapSearchResultBorder} />
                  ) : null}
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>
      ) : (
        <IconButton
          icon={MagnifyingGlassIcon}
          size="sm"
          onPress={openSearch}
          style={[styles.mapSearchButton, { top }]}
        />
      )}
      {bottomControlsVisible && !addMenuOpen ? (
        <MapPointFilterMenu
          bottom={bottom}
          open={filterMenuOpen}
          hiddenCategories={hiddenMapPointCategories}
          onToggleMenu={toggleFilterMenu}
          onToggleCategory={toggleMapPointCategoryVisibility}
        />
      ) : null}
      {bottomControlsVisible ? (
        <MapPointAddMenu
          bottom={bottom}
          sheetBottom={sheetBottom}
          open={addMenuOpen}
          navigationAction={navigationAction}
          onToggle={toggleAddMenu}
          onSelectCategory={handleSelectMapPoint}
          onSelectNavigationPoint={() => void handleSelectNavigationPoint()}
        />
      ) : null}
    </>
  )
}

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
            navigationStatus={navigationStatus}
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
  mapTopBackButton: {
    position: 'absolute',
    left: 12,
    zIndex: 32,
    borderColor: theme.alpha(theme.palette.slate.light, 0.3),
    backgroundColor: theme.alpha(theme.palette.slate.surfaceDeep, 0.85),
  },
  mapSearchButton: {
    position: 'absolute',
    right: 12,
    zIndex: 44,
    borderColor: theme.alpha(theme.palette.slate.light, 0.3),
    backgroundColor: theme.alpha(theme.palette.slate.surfaceDeep, 0.85),
  },
  mapSearchSheet: {
    position: 'absolute',
    left: 12,
    right: 12,
    zIndex: 44,
    gap: 8,
  },
  mapSearchBar: {
    height: 50,
    borderRadius: 25,
    borderWidth: 1,
    borderColor: theme.alpha(theme.palette.slate.light, 0.3),
    backgroundColor: theme.alpha(theme.palette.slate.surfaceDeep, 0.85),
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingLeft: 14,
    paddingRight: 0,
  },
  mapSearchInput: {
    flex: 1,
    minWidth: 0,
    color: theme.palette.slate.textPrimary,
    fontSize: 15,
    fontWeight: '700',
    paddingVertical: 10,
  },
  mapSearchClose: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mapSearchClosePressed: {
    opacity: 0.55,
  },
  mapSearchResults: {
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: theme.alpha(theme.palette.slate.light, 0.3),
    backgroundColor: theme.alpha(theme.palette.slate.surfaceDeep, 0.85),
  },
  mapSearchStatusRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
  },
  mapSearchStatusText: {
    color: theme.palette.slate.textSecondary,
    fontSize: 12,
    fontWeight: '700',
  },
  mapSearchErrorText: {
    color: theme.status.error.text,
    fontSize: 12,
    fontWeight: '700',
  },
  mapSearchResult: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingLeft: 8,
    paddingRight: 14,
    position: 'relative',
  },
  mapSearchResultPressed: {
    opacity: 0.55,
  },
  mapSearchResultIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: theme.palette.green.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.palette.slate.surfaceDeep,
  },
  mapSearchResultText: {
    flex: 1,
    minWidth: 0,
  },
  mapSearchResultTitle: {
    color: theme.palette.slate.textPrimary,
    fontSize: 13,
    fontWeight: '800',
  },
  mapSearchResultSubtitle: {
    color: theme.palette.slate.textMuted,
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
  },
  mapSearchResultBorder: {
    position: 'absolute',
    left: 54,
    right: 0,
    bottom: 0,
    height: 1,
    backgroundColor: theme.alpha(theme.palette.slate.light, 0.3),
  },
  centerPlacementPointer: {
    ...StyleSheet.absoluteFill,
    zIndex: 29,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerPlacementBall: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 2,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.alpha(theme.palette.slate.surfaceDeep, 0.4),
  },
  centerPlacementPulse: {
    position: 'absolute',
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 2,
    backgroundColor: theme.alpha(theme.palette.slate.surfaceDeep, 0.3),
  },
  centerPlacementDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
})
