import { createContext, useContext } from 'react'
import { Platform } from 'react-native'

/**
 * Which renderer draws the main map's points: the rider puck and the marker-view points
 * (`InMapMarker`).
 * - `view`: marker views, positioned on the UI thread; they trail the map by about a frame while
 *   the camera moves.
 * - `layer`: drawn by a Mapbox custom layer inside the map's own render frame. Marker views stay
 *   mounted as the look's source and the touch target; native hides them on screen.
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
