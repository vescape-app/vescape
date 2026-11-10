import { useResolvedAccentColors } from '@/hooks/useTheme'
import {
  Camera,
  GeoJSONSource,
  Layer,
  Map,
  type CameraRef,
  type StyleSpecification,
  type ViewStateChangeEvent,
} from '@maplibre/maplibre-react-native'
import { useLocalSearchParams } from 'expo-router'
import { useCallback, useRef, useState } from 'react'
import { View, type NativeSyntheticEvent } from 'react-native'

import { ChipRow } from '@/components/dev/ShowcaseControls'
import { makeCircleFeature } from '@/helpers/mapGeometry'
import { ONE_DARK_OPENMAPTILES_STYLE } from '@/modules/map/constants/oneDarkOpenMapTilesStyle'
import type { EngineCamera } from '@/modules/map/lib/cameraEngine/engine'
import {
  PLAYGROUND_START,
  PLAYGROUND_START_ZOOM,
  playgroundStyles,
  useCameraPlayground,
} from '@/modules/map/screens/cameraPlayground'
import {
  useMapLibreLayersScene,
  type SceneAnchors,
} from '@/modules/map/screens/layersPlayground/MapLibreLayersScene'
import { BENCH_LAYERS, parseSceneLayers } from '@/modules/map/screens/layersPlayground/sceneData'

// Spike #642: MapLibre twin of the Mapbox playground on OpenFreeMap tiles, no key.
type BaseStyle = 'one-dark' | 'liberty'
const BASE_STYLES: Record<
  BaseStyle,
  { style: string | StyleSpecification; anchors: SceneAnchors }
> = {
  // Spike #656: One Dark ported to OpenMapTiles.
  'one-dark': {
    style: ONE_DARK_OPENMAPTILES_STYLE as StyleSpecification,
    anchors: { satelliteBeforeId: 'road-path', labelBeforeId: 'water-label' },
  },
  liberty: {
    style: 'https://tiles.openfreemap.org/styles/liberty',
    anchors: {
      satelliteBeforeId: 'tunnel_motorway_link_casing',
      labelBeforeId: 'road_one_way_arrow',
    },
  },
}
const isBaseStyle = (value: string | undefined): value is BaseStyle =>
  value === 'one-dark' || value === 'liberty'

/**
 * Spike #655: the same engine and drivers as the Mapbox playground, written through the patched
 * `setCameraDirect` (one native camera write per frame, no SDK animation) and
 * `cancelCameraAnimations`. Camera-changed echoes are matched against the written frames.
 */
export function MapLibrePlaygroundScreen() {
  // Spike #657 deep link: ?layers=route,markers&view=europe&gps=off&marker=ViewAnnotation
  // Spike #658: ?bench=1 starts the benchmark after mount.
  const params = useLocalSearchParams<{
    layers?: string
    view?: 'europe' | 'ride'
    gps?: string
    marker?: 'Marker' | 'ViewAnnotation'
    style?: string
    bench?: string
  }>()
  const [baseStyle, setBaseStyle] = useState<BaseStyle>(
    isBaseStyle(params.style) ? params.style : 'one-dark',
  )
  const accents = useResolvedAccentColors()
  const cameraRef = useRef<CameraRef>(null)
  // The scene hook needs the playground's snapCamera, so the playground reaches the scene late.
  const setSceneLayersRef = useRef<(on: boolean) => void>(() => {})

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
    style: baseStyle,
    autoBenchmark: params.bench === '1',
    setSceneLayers: (on) => setSceneLayersRef.current(on),
  })
  const scene = useMapLibreLayersScene({
    snapCamera,
    gpsFix,
    anchors: BASE_STYLES[baseStyle].anchors,
    initialLayers: parseSceneLayers(params.layers),
    initialView: params.view,
    initialMarkerKind: params.marker,
  })

  setSceneLayersRef.current = (on) => scene.setLayers(on ? BENCH_LAYERS : [])

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
          mapStyle={BASE_STYLES[baseStyle].style}
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
      {renderPanel(
        <>
          <ChipRow
            label="style"
            options={['one-dark', 'liberty']}
            selected={baseStyle}
            onSelect={(value) => setBaseStyle(value as BaseStyle)}
          />
          {scene.panel}
        </>,
      )}
    </View>
  )
}
