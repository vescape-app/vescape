import {
  GeoJSONSource,
  Images,
  Layer,
  Marker,
  RasterSource,
  ViewAnnotation,
  type PressEventWithFeatures,
} from '@maplibre/maplibre-react-native'
import { Profiler, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { StyleSheet, View, type NativeSyntheticEvent } from 'react-native'
import { useSharedValue } from 'react-native-reanimated'

import { Button } from '@/components/base/Button'
import { Text } from '@/components/base/Text'
import { ChipRow, ToggleRow, ValueRow } from '@/components/dev/ShowcaseControls'
import { theme } from '@/constants/theme'
import { GpsPuck, type MapPose } from '@/modules/map/components/GpsPuck'

import {
  countries,
  initialLayerState,
  routeShape,
  SCENE_CENTER,
  SCENE_LAYERS,
  useRiders,
  useSceneStyle,
  type MarkerRate,
  type SceneLayer,
} from './sceneData'
import { SceneRider } from './SceneRider'

// Spike #657: the app's map layer types on MapLibre v11, with fixture data.

type MarkerKind = 'Marker' | 'ViewAnnotation'
const SATELLITE_TILES = [
  `https://api.mapbox.com/v4/mapbox.satellite/{z}/{x}/{y}.jpg90?access_token=${process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN ?? ''}`,
]
const EUROPE_VIEW = { center: [15, 50] as [number, number], zoom: 3.6 }
const RIDE_VIEW_ZOOM = 14

/** Base-style layer ids app layers are inserted under; they differ per base style. */
export interface SceneAnchors {
  /** First road layer: satellite imagery goes under roads and labels. */
  satelliteBeforeId: string
  /** First label layer: fills go under it so labels stay on top. Unset = on top of the style. */
  labelBeforeId?: string
}

export function useMapLibreLayersScene({
  snapCamera,
  gpsFix,
  anchors,
  initialLayers,
  initialView,
  initialMarkerKind,
}: {
  snapCamera: (center: [number, number], zoom: number) => void
  anchors: SceneAnchors
  gpsFix: [number, number]
  initialLayers: SceneLayer[]
  initialView?: 'europe' | 'ride'
  initialMarkerKind?: MarkerKind
}) {
  const { accents, routeGradient, riderColors, countryFill, symbols } = useSceneStyle()
  const [on, setOn] = useState(() => initialLayerState(initialLayers))
  const [markerKind, setMarkerKind] = useState<MarkerKind>(initialMarkerKind ?? 'Marker')
  const [markerRate, setMarkerRate] = useState<MarkerRate>('frame')
  const [lastPress, setLastPress] = useState('-')
  const [renderStats, setRenderStats] = useState('-')

  const riders = useRiders(on.markers, markerRate)

  const profile = useRef({ commits: 0, sum: 0, max: 0, since: Date.now() })
  const onRender = useCallback((_id: string, _phase: string, actualMs: number) => {
    const p = profile.current
    p.commits++
    p.sum += actualMs
    p.max = Math.max(p.max, actualMs)
    const now = Date.now()
    if (now - p.since < 2000) return
    const line = `${(p.commits / ((now - p.since) / 1000)).toFixed(1)} commits/s, render avg ${(p.sum / p.commits).toFixed(2)}ms max ${p.max.toFixed(2)}ms`
    console.log(`[layers-playground] markers ${line}`)
    setRenderStats(line)
    profile.current = { commits: 0, sum: 0, max: 0, since: now }
  }, [])

  const puckBearing = useSharedValue<number | null>(45)
  const mapPose = useSharedValue<MapPose>({ heading: 0, pitch: 0 })

  const onCountryPress = useCallback((event: NativeSyntheticEvent<PressEventWithFeatures>) => {
    event.stopPropagation()
    const props = event.nativeEvent.features[0]?.properties
    const line = props ? `country ${props.ADM0_A3} (ISO_A3 ${props.ISO_A3}, ${props.NAME})` : '-'
    console.log(`[layers-playground] press ${line}`)
    setLastPress(line)
  }, [])
  const onSymbolPress = useCallback((event: NativeSyntheticEvent<PressEventWithFeatures>) => {
    event.stopPropagation()
    const line = `symbol ${event.nativeEvent.features[0]?.properties?.label ?? '?'}`
    console.log(`[layers-playground] press ${line}`)
    setLastPress(line)
  }, [])
  const onMarkerPress = useCallback((index: number) => {
    const line = `rider marker ${index}`
    console.log(`[layers-playground] press ${line}`)
    setLastPress(line)
  }, [])

  const writeView = (view: 'europe' | 'ride') =>
    view === 'europe'
      ? snapCamera(EUROPE_VIEW.center, EUROPE_VIEW.zoom)
      : snapCamera(SCENE_CENTER, RIDE_VIEW_ZOOM)
  const writeViewRef = useRef(writeView)
  writeViewRef.current = writeView
  useEffect(() => {
    if (!initialView) return
    const id = setTimeout(() => writeViewRef.current(initialView), 3000)
    return () => clearTimeout(id)
  }, [initialView])

  const MarkerComponent = markerKind === 'Marker' ? Marker : ViewAnnotation

  const mapChildren: ReactNode = (
    <>
      {on.satellite && (
        <RasterSource id="layers-satellite" tiles={SATELLITE_TILES} tileSize={256}>
          <Layer id="layers-satellite-layer" type="raster" beforeId={anchors.satelliteBeforeId} />
        </RasterSource>
      )}
      {on.countries && (
        <GeoJSONSource id="layers-countries" data={countries} onPress={onCountryPress}>
          <Layer
            id="layers-countries-fill"
            type="fill"
            beforeId={anchors.labelBeforeId}
            paint={{
              'fill-color': countryFill as never,
              'fill-opacity': 0.48,
            }}
          />
          <Layer
            id="layers-countries-outline"
            type="line"
            beforeId={anchors.labelBeforeId}
            paint={{
              'line-color': theme.palette.mono.white,
              'line-width': ['interpolate', ['linear'], ['zoom'], 3, 0.75, 6, 1.6],
            }}
          />
        </GeoJSONSource>
      )}
      {on.extrusion && (
        <Layer
          id="layers-extrusion"
          type="fill-extrusion"
          source="openmaptiles"
          source-layer="building"
          minzoom={14}
          paint={{
            'fill-extrusion-color': accents.violet.color,
            'fill-extrusion-height': ['get', 'render_height'],
            'fill-extrusion-base': ['get', 'render_min_height'],
            'fill-extrusion-opacity': 0.85,
          }}
        />
      )}
      {on.route && (
        <GeoJSONSource id="layers-route" data={routeShape} lineMetrics>
          <Layer
            id="layers-route-casing"
            type="line"
            layout={{ 'line-cap': 'round', 'line-join': 'round' }}
            paint={{ 'line-color': theme.palette.mono.black, 'line-opacity': 0.6, 'line-width': 9 }}
          />
          <Layer
            id="layers-route-line"
            type="line"
            layout={{ 'line-cap': 'round', 'line-join': 'round' }}
            paint={{ 'line-width': 5, 'line-gradient': routeGradient as never }}
          />
        </GeoJSONSource>
      )}
      {on.symbols && (
        <>
          <Images
            images={{
              sygnet: require('../../../../../assets/images/favicon.png'),
              splash: require('../../../../../assets/images/splashIcon.png'),
            }}
          />
          <GeoJSONSource id="layers-symbols" data={symbols} onPress={onSymbolPress}>
            <Layer
              id="layers-symbols-layer"
              type="symbol"
              layout={{
                'icon-image': ['get', 'icon'],
                'icon-size': ['match', ['get', 'icon'], 'splash', 0.06, 0.6],
                'text-field': ['get', 'label'],
                'text-font': ['Noto Sans Bold'],
                'text-size': 12,
                'text-offset': [0, 1.4],
                'icon-allow-overlap': true,
                'text-allow-overlap': true,
              }}
              paint={{
                'text-color': theme.palette.mono.white,
                'text-halo-color': theme.palette.mono.black,
                'text-halo-width': 1.5,
              }}
            />
          </GeoJSONSource>
        </>
      )}
      {on.markers && (
        <Profiler id="layers-markers" onRender={onRender}>
          <MarkerComponent id="layers-live-puck" lngLat={gpsFix}>
            <GpsPuck color={accents.purple.color} bearing={puckBearing} mapPose={mapPose} />
          </MarkerComponent>
          {riders.map((lngLat, index) => (
            <MarkerComponent
              key={`${markerKind}-${index}`}
              id={`layers-rider-${index}`}
              lngLat={lngLat}
              onPress={() => onMarkerPress(index)}
            >
              <SceneRider index={index} color={riderColors[index % riderColors.length]!} />
            </MarkerComponent>
          ))}
        </Profiler>
      )}
    </>
  )

  const panel: ReactNode = (
    <View style={styles.panel}>
      <Text style={styles.section}>Layers (#657)</Text>
      {SCENE_LAYERS.map((layer) => (
        <ToggleRow
          key={layer}
          label={layer}
          value={on[layer]}
          onToggle={(value) => setOn((prev) => ({ ...prev, [layer]: value }))}
        />
      ))}
      <ChipRow
        label="marker"
        options={['Marker', 'ViewAnnotation']}
        selected={markerKind}
        onSelect={(value) => setMarkerKind(value as MarkerKind)}
      />
      <ChipRow
        label="rate"
        options={['frame', '1 Hz', 'paused']}
        selected={markerRate}
        onSelect={(value) => setMarkerRate(value as MarkerRate)}
      />
      <View style={styles.buttons}>
        <Button label="Europe" onPress={() => writeView('europe')} size="sm" variant="secondary" />
        <Button label="Ride" onPress={() => writeView('ride')} size="sm" variant="secondary" />
      </View>
      <ValueRow label="last press" value={lastPress} />
      <Text style={styles.stats}>{renderStats}</Text>
    </View>
  )

  return {
    mapChildren,
    panel,
    setLayers: (layers: SceneLayer[]) => setOn(initialLayerState(layers)),
  }
}

const styles = StyleSheet.create({
  panel: { gap: 8 },
  section: {
    color: theme.palette.sky.color,
    fontSize: 11,
    fontWeight: '800',
    fontFamily: 'monospace',
    marginTop: 6,
  },
  stats: { color: theme.neutral.textMuted, fontSize: 11, fontFamily: 'monospace' },
  buttons: { flexDirection: 'row', gap: 8 },
})
