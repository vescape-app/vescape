/**
 * Puck spike: which renderer draws the rider puck on the MapLibre main map.
 * - `view`: the marker-view `GpsPuck` (default).
 * - `layer`: a native custom style layer drawn inside the map's own frame (Metal on iOS, GL on
 *   Android).
 * - `both`: both at once, to compare the trailing side by side.
 */
const PUCK_RENDERER = 'layer' as 'view' | 'layer' | 'both'

export const puckLayerEnabled = PUCK_RENDERER !== 'view'
export const puckViewEnabled = !puckLayerEnabled || PUCK_RENDERER === 'both'

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
