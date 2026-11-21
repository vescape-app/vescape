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

export function getModalCoordinateOffset() {
  if (Platform.OS !== 'android') return 0

  const windowHeight = Dimensions.get('window').height
  const screenHeight = Dimensions.get('screen').height
  return Math.max(0, screenHeight - windowHeight)
}

export function measureTrigger(ref: React.RefObject<View | null>) {
  return new Promise<TriggerLayout>((resolve) => {
    const view = ref.current
    if (!view) {
      const window = Dimensions.get('window')
      resolve({ x: window.width / 2, y: window.height / 2, width: 0, height: 0 })
      return
    }
    view.measureInWindow((x, y, width, height) => {
      resolve({ x, y, width, height })
    })
  })
}
