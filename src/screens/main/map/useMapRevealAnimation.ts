import { useEffect, useRef, useState } from 'react'
import { Animated } from 'react-native'

/**
 * The map fades in only once its first camera is in place, so the rider never sees the world
 * scrub from a default position to their own.
 */
export function useMapRevealAnimation({
  settingsLoaded,
  cameraReady,
  centerCoordinate,
}: {
  settingsLoaded: boolean
  cameraReady: boolean
  centerCoordinate: [number, number]
}) {
  const mapRevealedRef = useRef(false)
  const [mapOpacity] = useState(() => new Animated.Value(0))

  useEffect(() => {
    if (mapRevealedRef.current) return
    mapOpacity.setValue(0)
  }, [centerCoordinate, mapOpacity])

  useEffect(() => {
    if (!settingsLoaded || !cameraReady) return
    Animated.timing(mapOpacity, {
      toValue: 1,
      duration: 200,
      useNativeDriver: true,
    }).start(() => {
      mapRevealedRef.current = true
    })
  }, [cameraReady, mapOpacity, settingsLoaded])

  return { mapOpacity, mapRevealedRef }
}
