import type { RefObject } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import type { SharedValue } from 'react-native-reanimated'

import { MapOrientationSelector } from '@/modules/map/components/MapOrientationSelector'
import { MapStyleSwitch } from '@/modules/map/components/MapStyleSwitch'
import type { MapOrientationMode, MapStyleKey } from '@/modules/map/constants/mapStyles'
import type { MainMapHandle } from '@/screens/main/map/MainMap'
import type { MapSelector } from '@/screens/main/mainScreenStore'
import type { MainViewState } from '@/screens/main/mainViewState'

interface MapControlsProps {
  mode: MainViewState
  mapRef: RefObject<MainMapHandle | null>
  heading: SharedValue<number>
  mapStyleKey: MapStyleKey
  setMapStyleKey: (key: MapStyleKey) => void
  mapOrientationMode: MapOrientationMode
  setMapOrientationMode: (mode: MapOrientationMode) => void
  mapSelector: MapSelector
  setMapSelector: (selector: MapSelector) => void
}

/** The two map selectors pinned to the left edge: camera behaviour and basemap style. */
export function MapControls({
  mode,
  mapRef,
  heading,
  mapStyleKey,
  setMapStyleKey,
  mapOrientationMode,
  setMapOrientationMode,
  mapSelector,
  setMapSelector,
}: MapControlsProps) {
  const showNavigationSelector = mode !== 'history' && mode !== 'weather' && mode !== 'legalLimits'
  const navigationExpanded = showNavigationSelector && mapSelector === 'navigation'
  const styleExpanded = mapSelector === 'style'
  const selectorOpen = navigationExpanded || styleExpanded

  return (
    <View pointerEvents="box-none" style={styles.mapControlsLayer}>
      {selectorOpen ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close map selector"
          style={styles.mapSelectorDismissLayer}
          onPress={() => setMapSelector(null)}
        />
      ) : null}
      <View pointerEvents="box-none" style={styles.mapSelectors}>
        {showNavigationSelector ? (
          <MapOrientationSelector
            activeMode={mapOrientationMode}
            heading={heading}
            expanded={navigationExpanded}
            size="sm"
            onToggle={() => setMapSelector(mapSelector === 'navigation' ? null : 'navigation')}
            onSelect={(nextMode) => {
              if (mapOrientationMode === 'freeRotate' && nextMode !== 'freeRotate') {
                mapRef.current?.resetRotation()
              }
              setMapOrientationMode(nextMode)
            }}
          />
        ) : null}
        <MapStyleSwitch
          activeKey={mapStyleKey}
          expanded={styleExpanded}
          size="sm"
          onToggle={() => setMapSelector(mapSelector === 'style' ? null : 'style')}
          onSelect={setMapStyleKey}
        />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  mapControlsLayer: {
    ...StyleSheet.absoluteFill,
    zIndex: 41,
  },
  mapSelectorDismissLayer: {
    ...StyleSheet.absoluteFill,
    zIndex: 1,
  },
  mapSelectors: {
    position: 'absolute',
    left: 12,
    top: '50%',
    marginTop: -42,
    zIndex: 30,
    alignItems: 'flex-start',
    gap: 8,
  },
})
