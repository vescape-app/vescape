import { useCallback, useState } from 'react'
import { type LayoutChangeEvent } from 'react-native'

/**
 * Measured size of a canvas host view. Skia canvases do not grow to their
 * content and cannot use `onLayout` on Fabric, so the host view is measured
 * instead and its size drives the canvas geometry.
 */
export function useCanvasSize() {
  const [size, setSize] = useState({ w: 0, h: 0 })
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout
    setSize((prev) => (prev.w === width && prev.h === height ? prev : { w: width, h: height }))
  }, [])
  return { size, onLayout }
}
