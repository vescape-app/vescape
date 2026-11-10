import { useEffect, useMemo, useState } from 'react'

import { distanceMeters, offsetCoordinate } from '@/helpers/mapGeometry'
import { useResolvedAccentColors } from '@/hooks/useTheme'

import countriesJson from './naturalEarthCountries.json'
import rideRoute from './rideRoute.json'

// Spike #657/#658: scene data shared by the MapLibre and Mapbox layer scenes.

export const SCENE_LAYERS = [
  'route',
  'markers',
  'symbols',
  'satellite',
  'countries',
  'extrusion',
] as const
export type SceneLayer = (typeof SCENE_LAYERS)[number]
export type MarkerRate = 'frame' | '1 Hz' | 'paused'

const RIDER_COUNT = 10

// Fixed JS-only ramp for the speed gradient (spike; the app takes it from the theme).
const RAMP_MAX_KMH = 30
const MAX_GRADIENT_STOPS = 160

const route = rideRoute as [number, number, number][]
export const routeShape: GeoJSON.Feature<GeoJSON.LineString> = {
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
export function speedGradient(ramp: string[]): unknown[] {
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

export function symbolPoints(center: [number, number]): GeoJSON.FeatureCollection<GeoJSON.Point> {
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

/** Layers the benchmark (#658) switches on: everything both SDKs can draw without a token. */
export const BENCH_LAYERS: SceneLayer[] = ['route', 'markers', 'symbols', 'countries', 'extrusion']

export const countries = countriesJson as GeoJSON.FeatureCollection

/** Ride start: symbols and riders sit here so they are on screen with the route. */
export const SCENE_CENTER: [number, number] = [route[0]![0], route[0]![1]]

export const initialLayerState = (layers: SceneLayer[]) =>
  Object.fromEntries(SCENE_LAYERS.map((l) => [l, layers.includes(l)])) as Record<
    SceneLayer,
    boolean
  >

/** Rider markers: positions pushed through React state, every frame or once a second. */
export function useRiders(enabled: boolean, rate: MarkerRate) {
  const [riders, setRiders] = useState(() => riderPositions(SCENE_CENTER, 0))
  useEffect(() => {
    if (!enabled) return
    const start = performance.now()
    let raf = 0
    let interval: ReturnType<typeof setInterval> | undefined
    const tick = () => setRiders(riderPositions(SCENE_CENTER, (performance.now() - start) / 1000))
    if (rate === 'frame') {
      const loop = () => {
        tick()
        raf = requestAnimationFrame(loop)
      }
      raf = requestAnimationFrame(loop)
    } else if (rate === '1 Hz') {
      interval = setInterval(tick, 1000)
    }
    return () => {
      cancelAnimationFrame(raf)
      if (interval) clearInterval(interval)
    }
  }, [enabled, rate])
  return riders
}

/** Colors and fixed data both SDK scenes draw with, so their layer load stays identical. */
export function useSceneStyle() {
  const accents = useResolvedAccentColors()
  return useMemo(
    () => ({
      accents,
      routeGradient: speedGradient([accents.green.color, accents.amber.color, accents.red.color]),
      riderColors: [
        accents.green.color,
        accents.sky.color,
        accents.amber.color,
        accents.red.color,
        accents.violet.color,
      ],
      countryFill: [
        'match',
        ['get', 'ADM0_A3'],
        ['POL', 'CZE', 'SVK', 'LTU'],
        accents.green.color,
        ['DEU', 'AUT', 'HUN'],
        accents.amber.color,
        ['FRA', 'NOR'],
        accents.red.color,
        accents.sky.color,
      ] as unknown[],
      symbols: symbolPoints(SCENE_CENTER),
    }),
    [accents],
  )
}
