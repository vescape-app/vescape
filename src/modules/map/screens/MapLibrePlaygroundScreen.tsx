import { useResolvedAccentColors } from '@/hooks/useTheme'
import {
  Camera,
  GeoJSONSource,
  Layer,
  Map,
  type CameraRef,
  type ViewStateChangeEvent,
} from '@maplibre/maplibre-react-native'
import { useLocalSearchParams } from 'expo-router'
import { useCallback, useRef } from 'react'
import { View, type NativeSyntheticEvent } from 'react-native'

import { makeCircleFeature } from '@/helpers/mapGeometry'
import type { EngineCamera } from '@/modules/map/lib/cameraEngine/engine'
import {
  PLAYGROUND_START,
  PLAYGROUND_START_ZOOM,
  playgroundStyles,
  useCameraPlayground,
} from '@/modules/map/screens/cameraPlayground'
import {
  parseSceneLayers,
  useMapLibreLayersScene,
} from '@/modules/map/screens/layersPlayground/MapLibreLayersScene'

// Spike #642: MapLibre twin of the Mapbox playground, OpenFreeMap style, no key.
const OPENFREEMAP_LIBERTY = 'https://tiles.openfreemap.org/styles/liberty'

/**
 * Spike #655: the same engine and drivers as the Mapbox playground, written through the patched
 * `setCameraDirect` (one native camera write per frame, no SDK animation) and
 * `cancelCameraAnimations`. Camera-changed echoes are matched against the written frames.
 */
export function MapLibrePlaygroundScreen() {
  // Spike #657 deep link: ?layers=route,markers&view=europe&gps=off&marker=ViewAnnotation
  const params = useLocalSearchParams<{
    layers?: string
    view?: 'europe' | 'ride'
    gps?: string
    marker?: 'Marker' | 'ViewAnnotation'
  }>()
  const accents = useResolvedAccentColors()
  const cameraRef = useRef<CameraRef>(null)

  const applyCamera = useCallback((camera: EngineCamera) => {
    cameraRef.current?.setCameraDirect({
      center: camera.centerCoordinate,
      zoom: camera.zoomLevel,
      bearing: camera.heading,
      pitch: camera.pitch,
      padding: camera.padding && {
        top: camera.padding.paddingTop,
        right: camera.padding.paddingRight,
        bottom: camera.padding.paddingBottom,
        left: camera.padding.paddingLeft,
      },
    })
  }, [])
  const cancelNativeMotion = useCallback(() => cameraRef.current?.cancelCameraAnimations(), [])
  const { gpsFix, renderPanel, snapCamera, onCameraEcho } = useCameraPlayground({
    name: 'maplibre',
    applyCamera,
    cancelNativeMotion,
    initialGpsRunning: params.gps !== 'off',
  })
  const scene = useMapLibreLayersScene({
    snapCamera,
    gpsFix,
    initialLayers: parseSceneLayers(params.layers),
    initialView: params.view,
    initialMarkerKind: params.marker,
  })

  const onRegionIsChanging = useCallback(
    ({ nativeEvent }: NativeSyntheticEvent<ViewStateChangeEvent>) =>
      onCameraEcho({
        center: [nativeEvent.center[0], nativeEvent.center[1]],
        zoom: nativeEvent.zoom,
        heading: nativeEvent.bearing,
        pitch: nativeEvent.pitch,
      }),
    [onCameraEcho],
  )

  return (
    <View style={playgroundStyles.screen}>
      <View style={playgroundStyles.mapPane}>
        <Map
          style={playgroundStyles.map}
          mapStyle={OPENFREEMAP_LIBERTY}
          logo={false}
          attribution={false}
          compass={false}
          onRegionIsChanging={onRegionIsChanging}
        >
          <Camera
            ref={cameraRef}
            initialViewState={{ center: PLAYGROUND_START, zoom: PLAYGROUND_START_ZOOM }}
          />
          <GeoJSONSource id="playground-fix" data={makeCircleFeature(gpsFix[0], gpsFix[1], 8)}>
            <Layer
              id="playground-fix-fill"
              type="fill"
              paint={{
                'fill-color': accents.violet.color,
                'fill-outline-color': accents.violet.light,
              }}
            />
          </GeoJSONSource>
          {scene.mapChildren}
        </Map>
      </View>
      {renderPanel(scene.panel)}
    </View>
  )
}
