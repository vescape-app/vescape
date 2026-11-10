import {
  GeoJSONSource,
  Images,
  Layer,
  Marker,
  RasterSource,
  ViewAnnotation,
  type PressEventWithFeatures,
} from '@maplibre/maplibre-react-native'
import { Profiler, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { StyleSheet, View, type NativeSyntheticEvent } from 'react-native'
import { useSharedValue } from 'react-native-reanimated'

import { Button } from '@/components/base/Button'
import { Text } from '@/components/base/Text'
import { ChipRow, ToggleRow, ValueRow } from '@/components/dev/ShowcaseControls'
import { theme } from '@/constants/theme'
import { distanceMeters, offsetCoordinate } from '@/helpers/mapGeometry'
import { useResolvedAccentColors } from '@/hooks/useTheme'
import { GpsPuck, type MapPose } from '@/modules/map/components/GpsPuck'

import countries from './naturalEarthCountries.json'
import rideRoute from './rideRoute.json'

// Spike #657: the app's map layer types on MapLibre v11, with fixture data.

export const SCENE_LAYERS = [
  'route',
  'markers',
  'symbols',
  'satellite',
  'countries',
  'extrusion',
] as const
export type SceneLayer = (typeof SCENE_LAYERS)[number]
type MarkerKind = 'Marker' | 'ViewAnnotation'
type MarkerRate = 'frame' | '1 Hz' | 'paused'

const RIDER_COUNT = 10
/** First road layer of the OpenFreeMap liberty style: imagery goes under roads and labels. */
const SATELLITE_BEFORE_ID = 'tunnel_motorway_link_casing'
const SATELLITE_TILES = [
  `https://api.mapbox.com/v4/mapbox.satellite/{z}/{x}/{y}.jpg90?access_token=${process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN ?? ''}`,
]
const EUROPE_VIEW = { center: [15, 50] as [number, number], zoom: 3.6 }
const RIDE_VIEW_ZOOM = 14

// Fixed JS-only ramp for the speed gradient (spike; the app takes it from the theme).
const RAMP_MAX_KMH = 30
const MAX_GRADIENT_STOPS = 160

const route = rideRoute as [number, number, number][]
const routeShape: GeoJSON.Feature<GeoJSON.LineString> = {
  type: 'Feature',
  properties: {},
  geometry: { type: 'LineString', coordinates: route.map(([lng, lat]) => [lng, lat]) },
}

function lerpHex(a: string, b: string, t: number) {
  const pa = parseInt(a.slice(1), 16)
  const pb = parseInt(b.slice(1), 16)
  const ch = (shift: number) =>
    Math.round(((pa >> shift) & 255) + (((pb >> shift) & 255) - ((pa >> shift) & 255)) * t)
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`
}

function speedColor(ramp: string[], kmh: number) {
  const x = Math.min(1, Math.max(0, kmh / RAMP_MAX_KMH)) * (ramp.length - 1)
  const i = Math.min(ramp.length - 2, Math.floor(x))
  return lerpHex(ramp[i]!, ramp[i + 1]!, x - i)
}

/** Same shape as `getHistoryRouteMetricGradient`: distance progress -> speed color stops. */
function speedGradient(ramp: string[]): unknown[] {
  const cumulative = [0]
  for (let i = 1; i < route.length; i++) {
    const [aLng, aLat] = route[i - 1]!
    const [bLng, bLat] = route[i]!
    cumulative.push(
      cumulative[i - 1]! +
        distanceMeters({ longitude: aLng, latitude: aLat }, { longitude: bLng, latitude: bLat }),
    )
  }
  const total = cumulative.at(-1) || 1
  const step = Math.max(1, Math.floor(route.length / (MAX_GRADIENT_STOPS - 1)))
  const expression: unknown[] = ['interpolate', ['linear'], ['line-progress']]
  let last = -1
  for (let i = 0; i < route.length; i += step) {
    const progress = cumulative[i]! / total
    if (progress <= last) continue
    last = progress
    expression.push(progress, speedColor(ramp, route[i]![2] * 3.6))
  }
  if (last < 1) expression.push(1, speedColor(ramp, route.at(-1)![2] * 3.6))
  return expression
}

function symbolPoints(center: [number, number]): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return {
    type: 'FeatureCollection',
    features: Array.from({ length: 16 }, (_, i) => ({
      type: 'Feature',
      id: i,
      properties: { icon: i % 2 ? 'sygnet' : 'splash', label: `P${i}` },
      geometry: {
        type: 'Point',
        coordinates: offsetCoordinate(center, (i * 360) / 16, 250 + (i % 4) * 150),
      },
    })),
  }
}

function riderPositions(center: [number, number], tSeconds: number): [number, number][] {
  return Array.from({ length: RIDER_COUNT }, (_, i) => {
    const angle = (tSeconds * (20 + i * 4) + i * 36) % 360
    return offsetCoordinate(center, angle, 120 + i * 40)
  })
}

const isLayer = (value: string): value is SceneLayer =>
  (SCENE_LAYERS as readonly string[]).includes(value)

export function parseSceneLayers(param: string | undefined): SceneLayer[] {
  return (param ?? '').split(',').filter(isLayer)
}

export function useMapLibreLayersScene({
  snapCamera,
  gpsFix,
  initialLayers,
  initialView,
  initialMarkerKind,
}: {
  snapCamera: (center: [number, number], zoom: number) => void
  gpsFix: [number, number]
  initialLayers: SceneLayer[]
  initialView?: 'europe' | 'ride'
  initialMarkerKind?: MarkerKind
}) {
  const accents = useResolvedAccentColors()
  const [on, setOn] = useState<Record<SceneLayer, boolean>>(
    () =>
      Object.fromEntries(SCENE_LAYERS.map((l) => [l, initialLayers.includes(l)])) as Record<
        SceneLayer,
        boolean
      >,
  )
  const [markerKind, setMarkerKind] = useState<MarkerKind>(initialMarkerKind ?? 'Marker')
  const [markerRate, setMarkerRate] = useState<MarkerRate>('frame')
  const [lastPress, setLastPress] = useState('-')
  const [renderStats, setRenderStats] = useState('-')

  const [riders, setRiders] = useState(() => riderPositions(PLAYGROUND_SYMBOL_CENTER, 0))

  // Rider markers: positions pushed through React state, every frame or once a second.
  useEffect(() => {
    if (!on.markers) return
    const start = performance.now()
    let raf = 0
    let interval: ReturnType<typeof setInterval> | undefined
    const tick = () =>
      setRiders(riderPositions(PLAYGROUND_SYMBOL_CENTER, (performance.now() - start) / 1000))
    if (markerRate === 'frame') {
      const loop = () => {
        tick()
        raf = requestAnimationFrame(loop)
      }
      raf = requestAnimationFrame(loop)
    } else if (markerRate === '1 Hz') {
      interval = setInterval(tick, 1000)
    }
    return () => {
      cancelAnimationFrame(raf)
      if (interval) clearInterval(interval)
    }
  }, [on.markers, markerRate])

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

  const routeGradient = useMemo(
    () => speedGradient([accents.green.color, accents.amber.color, accents.red.color]),
    [accents],
  )
  const riderColors = [
    accents.green.color,
    accents.sky.color,
    accents.amber.color,
    accents.red.color,
    accents.violet.color,
  ]
  const symbols = useMemo(() => symbolPoints(PLAYGROUND_SYMBOL_CENTER), [])

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
      : snapCamera(PLAYGROUND_SYMBOL_CENTER, RIDE_VIEW_ZOOM)
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
          <Layer id="layers-satellite-layer" type="raster" beforeId={SATELLITE_BEFORE_ID} />
        </RasterSource>
      )}
      {on.countries && (
        <GeoJSONSource
          id="layers-countries"
          data={countries as GeoJSON.FeatureCollection}
          onPress={onCountryPress}
        >
          <Layer
            id="layers-countries-fill"
            type="fill"
            paint={{
              'fill-color': [
                'match',
                ['get', 'ADM0_A3'],
                ['POL', 'CZE', 'SVK', 'LTU'],
                accents.green.color,
                ['DEU', 'AUT', 'HUN'],
                accents.amber.color,
                ['FRA', 'NOR'],
                accents.red.color,
                accents.sky.color,
              ],
              'fill-opacity': 0.48,
            }}
          />
          <Layer
            id="layers-countries-outline"
            type="line"
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
              <View style={styles.rider}>
                <View
                  style={[
                    styles.riderDot,
                    { backgroundColor: riderColors[index % riderColors.length] },
                  ]}
                />
                <Text style={styles.riderLabel}>{`Rider ${index}`}</Text>
              </View>
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

  return { mapChildren, panel }
}

/** Symbols sit at the ride start so they are on screen with the route. */
const PLAYGROUND_SYMBOL_CENTER: [number, number] = [route[0]![0], route[0]![1]]

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
  rider: { alignItems: 'center', gap: 2 },
  riderDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: theme.palette.mono.white,
  },
  riderLabel: {
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 5,
    overflow: 'hidden',
    backgroundColor: theme.alpha(theme.palette.mono.black, 0.7),
    color: theme.palette.mono.white,
    fontSize: 10,
    fontWeight: '800',
  },
})
