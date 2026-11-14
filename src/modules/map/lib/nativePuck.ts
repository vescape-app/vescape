import { Platform } from 'react-native'

/**
 * Which renderer draws the rider puck on the main map.
 * - `view`: the marker-view `GpsPuck`, positioned on the UI thread; it trails the map by about a
 *   frame while the camera moves.
 * - `layer`: a Mapbox custom layer drawn with GL inside the map's own render frame (Android).
 * - `both`: both at once, to compare the trailing side by side.
 * TODO(ios parity): no custom layer puck on iOS; it always falls back to the view puck.
 */
const PUCK_RENDERER = 'layer' as 'view' | 'layer' | 'both'

export const puckLayerEnabled = Platform.OS === 'android' && PUCK_RENDERER !== 'view'
export const puckViewEnabled = !puckLayerEnabled || PUCK_RENDERER === 'both'

/**
 * @parity /node_modules/@rnmapbox/maps/android/src/main/java/com/rnmapbox/rnmbx/components/camera/RNMBXPuck.kt
 */
export interface PuckLayerState {
  lngLat: [number, number]
  bearing: number | null
  /** ARGB as a 32-bit int, as `processColor` returns it. */
  color: number
  /** Black alpha of the coin's ground shadow; it depends on the basemap theme. */
  shadowAlpha: number
}

type Sink = (puck: PuckLayerState | null) => void

/**
 * Hands the puck to the camera, which owns the native call. Position and colour come from the
 * layer tree, bearing from the compass callback; each change goes out at once, the native layer
 * draws whatever it holds when the map renders.
 */
function createPuckLayerChannel() {
  let sink: Sink | null = null
  let lngLat: [number, number] | null = null
  let bearing: number | null = null
  let color = 0
  let shadowAlpha = 0
  const flush = () => {
    if (!sink) return
    sink(lngLat ? { lngLat, bearing, color, shadowAlpha } : null)
  }
  return {
    attach(next: Sink | null) {
      sink = next
      flush()
    },
    setPlacement(next: { lngLat: [number, number]; color: number; shadowAlpha: number } | null) {
      if (!puckLayerEnabled) return
      lngLat = next?.lngLat ?? null
      if (next) {
        color = next.color
        shadowAlpha = next.shadowAlpha
      }
      flush()
    },
    setBearing(next: number | null) {
      if (!puckLayerEnabled || next === bearing) return
      bearing = next
      if (lngLat) flush()
    },
  }
}

export const puckLayerChannel = createPuckLayerChannel()
