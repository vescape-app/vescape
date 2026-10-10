import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { Animated } from 'react-native'

/**
 * The map fades in only once its first camera is in place, so the rider never sees the world
 * scrub from a default position to their own.
 */
export function useMapRevealAnimation({
  settingsLoaded,
  cameraReady,
  setCameraReady,
  centerCoordinate,
}: {
  settingsLoaded: boolean
  cameraReady: boolean
  setCameraReady: Dispatch<SetStateAction<boolean>>
  centerCoordinate: [number, number]
}) {
  const mapRevealedRef = useRef(false)

  const [mapOpacity] = useState(() => new Animated.Value(0))

  // A new first camera hides the map again and waits for that camera to settle: clearing readiness
  // is what re-arms the reveal below, so a fix landing mid-fade cannot leave the map at zero.
  useEffect(() => {
    if (mapRevealedRef.current) return
    mapOpacity.setValue(0)
    setCameraReady(false)
  }, [centerCoordinate, mapOpacity, setCameraReady])

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

  return { mapOpacity }
}
