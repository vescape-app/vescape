import { useRef } from 'react'
import type { View } from 'react-native'
import { Dimensions, Platform } from 'react-native'

export interface TriggerLayout {
  x: number
  y: number
  width: number
  height: number
}

export function useTriggerRef() {
  return useRef<View>(null)
}

/**
 * Android renders `Modal` content in screen coordinates while `measureInWindow`
 * reports window coordinates. This offset bridges the gap (0 elsewhere).
 */
export function getModalCoordinateOffset() {
  if (Platform.OS !== 'android') return 0

  const windowHeight = Dimensions.get('window').height
  const screenHeight = Dimensions.get('screen').height
  return Math.max(0, screenHeight - windowHeight)
}

/**
 * Measure a trigger view in raw window coordinates. Callers add
 * {@link getModalCoordinateOffset} when positioning inside a `Modal`.
 */
export function measureTrigger(ref: React.RefObject<View | null>) {
  return new Promise<TriggerLayout>((resolve) => {
    ref.current?.measureInWindow((x, y, width, height) => {
      resolve({ x, y, width, height })
    })
  })
}
