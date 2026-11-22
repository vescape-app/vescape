import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { Animated } from 'react-native'

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
