import { createContext, useContext } from 'react'
import { Platform } from 'react-native'

/**
 * Which renderer draws the main map's points: the rider puck and the marker-view points
 * (`InMapMarker`).
 * - `view`: marker views, positioned on the UI thread; they trail the map by about a frame while
 *   the camera moves.
 * - `layer`: drawn by a Mapbox custom layer inside the map's own render frame. Marker views stay
 *   mounted but transparent, as the look's source and the touch target.
 * - `both`: both at once, to compare the trailing side by side.
 */
const MAP_POINT_RENDERER = 'layer' as 'view' | 'layer' | 'both'

export const mapLayerEnabled =
  (Platform.OS === 'android' || Platform.OS === 'ios') && MAP_POINT_RENDERER !== 'view'
const mapViewEnabled = !mapLayerEnabled || MAP_POINT_RENDERER === 'both'

/**
 * Set by the map whose camera feeds the native layer (the main map). Any other map, such as the
 * component showcase, has no layer behind it and draws its points as plain views.
 */
export const InMapLayerHostContext = createContext(false)

/** Whether points under this map are drawn by the native layer, and whether their views show too. */
export function useInMapLayer() {
  const layer = useContext(InMapLayerHostContext) && mapLayerEnabled
  return { layer, view: !layer || mapViewEnabled }
}

interface MarkerEntry {
  tag: number
  lngLat: [number, number]
  version: number
  burstMs: number
}

type Sink = (values: number[]) => void

/**
 * Hands the in-map markers to the camera, which owns the native call. Every change of any marker
 * is batched into one call per JS tick carrying the whole list, in mount order, which is the draw
 * order.
 *
 * @parity /node_modules/@rnmapbox/maps/android/src/main/java/com/rnmapbox/rnmbx/components/camera/RNMBXMarkerSprites.kt
 * @parity /node_modules/@rnmapbox/maps/ios/RNMBX/RNMBXMarkerSprites.swift
 */
function createMarkerLayerChannel() {
  let sink: Sink | null = null
  const entries = new Map<object, MarkerEntry>()
  let version = 0
  let scheduled = false
  const flush = () => {
    scheduled = false
    if (!sink) return
    const values: number[] = []
    for (const entry of entries.values()) {
      values.push(entry.tag, entry.lngLat[0], entry.lngLat[1], entry.version, entry.burstMs)
    }
    sink(values)
  }
  const schedule = () => {
    if (scheduled) return
    scheduled = true
    queueMicrotask(flush)
  }
  return {
    attach(next: Sink | null) {
      sink = next
      flush()
    },
    /** A new version makes native snapshot the view again, then every frame for `burstMs`. */
    set(key: object, tag: number, lngLat: [number, number], burstMs: number) {
      entries.set(key, { tag, lngLat, version: ++version, burstMs })
      schedule()
    },
    refresh(key: object) {
      const entry = entries.get(key)
      if (!entry) return
      entry.version = ++version
      schedule()
    },
    remove(key: object) {
      if (entries.delete(key)) schedule()
    },
  }
}

export const markerLayerChannel = createMarkerLayerChannel()
