import { createContext, useContext } from 'react'
import { Platform } from 'react-native'

const MAP_POINT_RENDERER = 'layer' as 'view' | 'layer' | 'both'

export const mapLayerEnabled =
  (Platform.OS === 'android' || Platform.OS === 'ios') && MAP_POINT_RENDERER !== 'view'
const mapViewEnabled = !mapLayerEnabled || MAP_POINT_RENDERER === 'both'

export const InMapLayerHostContext = createContext(false)

export function useInMapLayer() {
  const layer = useContext(InMapLayerHostContext) && mapLayerEnabled
  return { layer, view: !layer || mapViewEnabled }
}
