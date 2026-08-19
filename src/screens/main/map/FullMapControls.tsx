import * as Haptics from 'expo-haptics'
import { ArrowLeftIcon } from 'phosphor-react-native'
import { useCallback, useEffect, useRef, useState } from 'react'
import { StyleSheet } from 'react-native'
import type { MapPointCategory } from 'vescape-core'

import { IconButton } from '@/components/base/IconButton'
import { theme } from '@/constants/theme'
import { useResolvedAccentColors } from '@/hooks/useTheme'
import { useRiderStore } from '@/modules/group-ride/store/riderStore'
import type { MapSelection } from '@/modules/map/lib/mapSelection'
import type { MapSearchResult } from '@/modules/map/lib/search'
import { MapPointAddMenu } from '@/modules/map-points/components/MapPointAddMenu'
import { MapPointFilterMenu } from '@/modules/map-points/components/MapPointFilterMenu'
import { getMapPointKindLabel } from '@/modules/map-points/constants/mapPoints'
import { useMapPointStore } from '@/modules/map-points/store/mapPointStore'
import { CenterPlacementPointer } from '@/screens/main/map/CenterPlacementPointer'
import { MapSearch } from '@/screens/main/map/MapSearch'
import { navigationActionColors } from '@/screens/main/map/navigationActionColors'
import type { MapModeOverlayProps } from '@/screens/main/map/mapModeOverlayTypes'

export interface FullMapControlsProps extends Pick<
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
export function FullMapControls({
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
  const accents = useResolvedAccentColors()
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

  const clearPlacementTimeout = useCallback(() => {
    if (!placementTimeoutRef.current) return
    clearTimeout(placementTimeoutRef.current)
    placementTimeoutRef.current = null
  }, [])

  const closeAddMenu = useCallback(
    (restoreZoom = true) => {
      clearPlacementTimeout()
      if (addMenuOpen && restoreZoom && addMenuZoomedRef.current) {
        mapRef.current?.zoomBy(-0.45)
      }
      addMenuZoomedRef.current = false
      setPlacementPulseKey(0)
      onAddMenuVisibilityChange(false)
    },
    [addMenuOpen, clearPlacementTimeout, mapRef, onAddMenuVisibilityChange],
  )

  useEffect(() => {
    const dismissTransientControls = (selection?: MapSelection) => {
      if (addMenuOpen && selection) {
        mapRef.current?.centerCoordinatePreservingCamera([selection.longitude, selection.latitude])
        return true
      }
      if (!searchOpen && !filterMenuOpen) return false
      setSearchOpen(false)
      setFilterMenuOpen(false)
      return false
    }
    mapInteractionHandlerRef.current = dismissTransientControls
    return () => {
      if (mapInteractionHandlerRef.current === dismissTransientControls) {
        mapInteractionHandlerRef.current = () => {}
      }
    }
  }, [addMenuOpen, filterMenuOpen, mapInteractionHandlerRef, mapRef, searchOpen])

  useEffect(() => clearPlacementTimeout, [clearPlacementTimeout])

  const handleSearchSelect = useCallback(
    (result: MapSearchResult) => {
      setSearchOpen(false)
      mapRef.current?.focusCoordinate([result.longitude, result.latitude])
      onSelectNavigationTarget({
        type: 'place',
        id: result.id,
        latitude: result.latitude,
        longitude: result.longitude,
        title: result.title,
        subtitle: result.subtitle,
        category: result.category,
      })
    },
    [mapRef, onSelectNavigationTarget],
  )

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
      clearPlacementTimeout()
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
    [
      addMapPoint,
      clearPlacementTimeout,
      closeAddMenu,
      mapRef,
      onBeginEditMapPoint,
      onSelectNavigationTarget,
    ],
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

  return (
    <>
      {addMenuOpen ? (
        <CenterPlacementPointer
          color={riderColor ?? accents.green.color}
          pulseKey={placementPulseKey}
        />
      ) : null}
      <IconButton
        icon={ArrowLeftIcon}
        size="sm"
        testID="map-exit"
        onPress={handleExitMapFocus}
        style={[styles.backButton, { top }]}
      />
      <MapSearch
        open={searchOpen}
        top={top}
        searchProximity={searchProximity}
        onOpen={() => setSearchOpen(true)}
        onClose={() => setSearchOpen(false)}
        onSelectResult={handleSearchSelect}
      />
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
          navigationAction={navigationActionColors(
            riderColor,
            accents.green.solid,
            accents.green.onSolid,
          )}
          onToggle={toggleAddMenu}
          onSelectCategory={(category) => void handleSelectMapPoint(category)}
          onSelectNavigationPoint={() => void handleSelectNavigationPoint()}
        />
      ) : null}
    </>
  )
}

const styles = StyleSheet.create({
  backButton: {
    position: 'absolute',
    left: 12,
    zIndex: 32,
    borderColor: theme.alpha(theme.palette.slate.light, 0.3),
    backgroundColor: theme.alpha(theme.palette.slate.surfaceDeep, 0.85),
  },
})
