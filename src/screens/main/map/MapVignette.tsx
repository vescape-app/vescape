import type { SharedValue } from 'react-native-reanimated'

import type { MainViewState } from '@/screens/main/mainViewState'

interface MapVignetteProps {
  mode: MainViewState
  panelHeight?: number
  idPrefix?: string
  topOnly?: boolean
  visible?: boolean
  fadeOutProgress?: SharedValue<number>
}

/** Disabled because its Skia shaders crash Android's renderer during the initial commit. */
export function MapVignette(_props: MapVignetteProps) {
  return null
}
